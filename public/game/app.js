(function (namespace) {
  'use strict';

  const ui = new namespace.UI();
  let game = null;
  let currentAnswer = '';
  let initialTime = namespace.SETTINGS.initialTime;
  let entryMode = 'sequential';
  let gameMode = 'individual';
  let pauseOnHidden = true;
  let pausedByVisibility = false;
  let pendingHintType = null;
  let sharedSession = null;
  let syncTimer = null;
  let sharedRequestInFlight = false;
  let sharedPushPending = false;
  let remoteRevision = 0;
  let noticeSequence = 0;
  let lastParticipantNoticeId = null;
  let lastHostNoticeId = null;
  let hostUsedLetters = {};
  window.Conecta8HostUsedLetters = () => hostUsedLetters;
  const SAVE_KEY = 'conecta8-active-game-v2';
  const query = new URLSearchParams(window.location.search);
  const participantSessionId = query.get('session');
  const isParticipantView = query.get('view') === 'participant' && participantSessionId;

  const timer = new namespace.GameTimer({
    initialSeconds: namespace.SETTINGS.initialTime,
    onTick: (seconds) => {
      ui.updateTimer(seconds);
      saveActiveGame();
      if (sharedSession) pushSharedState();
    },
    onEnd: () => {
      if (!game || game.finished) return;
      game.end();
      ui.renderGame(game, handlers);
      ui.setMessage('Se terminó el tiempo. Puedes reiniciar la misma partida.', 'danger');
      ui.showTimeUp(restartGame, goHome);
    }
  });

  const handlers = {
    onSubmit(index, answer, cardElement) {
      if (!answer.trim() && game.getAnswerLength(index) > 0) {
        ui.animateWrong(cardElement);
        return;
      }
      const result = game.submit(index, answer);
      if (result.type === 'wrong') {
        ui.renderGame(game, handlers);
        ui.updateActiveEntry(game, currentAnswer);
        const updatedCard = ui.cardsGrid.querySelector(`[data-index="${index}"]`);
        ui.animateWrong(updatedCard);
        ui.setMessage('Respuesta incorrecta. Inténtalo otra vez.', 'danger');
        return;
      }
      if (result.type === 'attempts-reset') {
        currentAnswer = '';
        timer.adjust(result.timeChange);
        ui.renderGame(game, handlers);
        ui.setMessage('Tres errores: intentos reiniciados y 5 segundos menos.', 'danger');
        announce('−5 segundos', 'penalty');
        return;
      }
      if (result.type === 'correct') {
        currentAnswer = '';
        timer.adjust(result.timeChange);
        if (result.finished) {
          timer.stop();
          ui.renderGame(game, handlers);
          ui.setMessage(`¡Partida completada! Te quedaron ${timer.remaining} segundos.`, 'success');
          return;
        }
        ui.renderGame(game, handlers);
        ui.setMessage('¡Correcto! Sumaste 10 segundos.', 'success');
      }
    },

    onOpenHints() {
      if (!game || game.finished) return;
      timer.stop();
      ui.openHintMenu(game.hasDefinition(game.activeIndex), handlers);
    },

    onChooseHint(type) {
      pendingHintType = type;
      const costs = { sequential: 5, random: 10, definition: 15 };
      ui.showHintConfirmation(type, costs[type], handlers);
    },

    onConfirmHint() {
      const result = game.useHint(game.activeIndex, pendingHintType);
      if (result.type === 'unavailable' || result.type === 'ignored') return;
      timer.adjust(result.timeChange);
      announce(`−${Math.abs(result.timeChange)} segundos · Pista aplicada`, 'penalty');
      pushSharedState();
      if (result.type === 'definition') {
        ui.showDefinition(result.definition, handlers.onCloseHints);
        return;
      }
      const characters = Array.from(currentAnswer);
      characters.splice(result.removedEntryIndex, 1);
      currentAnswer = characters.join('');
      ui.renderGame(game, handlers);
      ui.updateActiveEntry(game, currentAnswer);
      ui.setMessage(`Pista revelada: ${Math.abs(result.timeChange)} segundos menos.`);
      ui.closeHintDialog();
      if (game.isCurrentAnswerCorrect(game.activeIndex, currentAnswer)) {
        const cardElement = ui.cardsGrid.querySelector(`[data-index="${game.activeIndex}"]`);
        handlers.onSubmit(game.activeIndex, currentAnswer, cardElement);
      } else if (!game.finished && timer.remaining > 0) timer.start();
    },

    onBackToHints() { ui.openHintMenu(game.hasDefinition(game.activeIndex), handlers); },

    onCloseHints() {
      pendingHintType = null;
      ui.closeHintDialog();
      if (game && !game.finished && timer.remaining > 0) timer.start();
    },

    onResumeVisibility() {
      if (!pausedByVisibility) return;
      pausedByVisibility = false;
      ui.closeHintDialog();
      if (game && !game.finished && timer.remaining > 0) {
        ui.setMessage('Partida reanudada.');
        timer.start();
      }
    },

    onKey(key) {
      if (!game || game.finished) return;
      if (key === 'ENTER') {
        const cardElement = ui.cardsGrid.querySelector(`[data-index="${game.activeIndex}"]`);
        handlers.onSubmit(game.activeIndex, currentAnswer, cardElement);
        return;
      }
      if (key === 'BORRAR') {
        currentAnswer = Array.from(currentAnswer).slice(0, -1).join('');
      } else if (game.getAnswerLength(game.activeIndex) > Array.from(currentAnswer).length) {
        currentAnswer += key;
      }
      ui.updateActiveEntry(game, currentAnswer);
      if (key !== 'BORRAR' && game.isCurrentAnswerCorrect(game.activeIndex, currentAnswer)) {
        const cardElement = ui.cardsGrid.querySelector(`[data-index="${game.activeIndex}"]`);
        handlers.onSubmit(game.activeIndex, currentAnswer, cardElement);
      }
    },

    onHostReveal() {
      if (!game || game.finished) return;
      const result = game.revealNextLetter(game.activeIndex);
      if (result.type === 'revealed') {
        ui.renderGame(game, handlers);
        ui.setMessage('Letra revelada por el anfitrión.');
        return;
      }
      handleHostCorrect(result);
    },

    onHostRevealPosition(position) {
      if (!game || game.finished) return;
      const result = game.revealPosition(game.activeIndex, position);
      if (result.type === 'correct') handleHostCorrect(result);
      else if (result.type === 'revealed') {
        ui.renderGame(game, handlers);
        ui.setMessage('Letra revelada desde el tablero.');
        pushSharedState();
      }
    },

    onHostLetter(letter) {
      if (!game || game.finished) return;
      const index = game.activeIndex;
      const result = game.guessLetter(index, letter);
      if (result.type === 'correct') return handleHostCorrect(result);
      if (result.type === 'ignored' || result.type === 'already-revealed') return;
      hostUsedLetters[letter] = result.type === 'wrong' || result.type === 'attempts-reset' ? 'wrong' : 'correct';
      if (sharedSession) {
        sharedSession.usedLetters = { ...(sharedSession.usedLetters || {}), [letter]: hostUsedLetters[letter] };
      }
      if (result.type === 'attempts-reset') timer.adjust(result.timeChange);
      ui.renderGame(game, handlers);
      if (result.type === 'wrong' || result.type === 'attempts-reset') {
        const cardElement = ui.cardsGrid.querySelector(`[data-index="${index}"]`);
        if (cardElement) ui.animateWrong(cardElement);
        announce(result.type === 'attempts-reset' ? '−5 s' : 'Letra incorrecta', result.type === 'attempts-reset' ? 'penalty' : 'error');
      } else announce(`Letra ${letter} descubierta`, 'success');
      ui.setMessage(`Palabra ${Math.min(game.activeIndex + 1, 8)} de 8`);
      pushSharedState();
    },

    onHostSolve() {
      if (!game || game.finished) return;
      handleHostCorrect(game.solveActive(game.activeIndex));
    },

    onHostWrong() {
      if (!game || game.finished) return;
      const index = game.activeIndex;
      const result = game.recordFailure(index);
      if (result.type === 'attempts-reset') timer.adjust(result.timeChange);
      ui.renderGame(game, handlers);
      const cardElement = ui.cardsGrid.querySelector(`[data-index="${index}"]`);
      if (cardElement) ui.animateWrong(cardElement);
      announce(result.type === 'attempts-reset' ? '−5 s' : 'Intento fallido', result.type === 'attempts-reset' ? 'penalty' : 'error');
      ui.setMessage(`Palabra ${Math.min(game.activeIndex + 1, 8)} de 8`);
      pushSharedState();
    }
  };

  function handleHostCorrect(result) {
    if (!result || result.type !== 'correct') return;
    timer.adjust(result.timeChange);
    hostUsedLetters = {};
    if (sharedSession) sharedSession.usedLetters = {};
    ui.renderGame(game, handlers);
    if (result.finished) {
      timer.stop();
      ui.setMessage(`¡Partida completada! Te quedaron ${timer.remaining} segundos.`, 'success');
    } else {
      ui.setMessage('¡Palabra descubierta! Sumaste 10 segundos.', 'success');
    }
    pushSharedState();
  }

  function announce(message, type = 'info') {
    ui.showToast(message, type);
    if (sharedSession) sharedSession.notice = { id: `${Date.now()}-${++noticeSequence}`, message, type };
    saveActiveGame();
  }

  function getSharedState() {
    return {
      entries: game.entries,
      cards: game.cards.map((card) => ({ attempts: card.attempts, revealedPositions: [...card.revealedPositions], solved: card.solved, isSeed: card.isSeed })),
      activeIndex: game.activeIndex,
      finished: game.finished,
      remaining: timer.remaining,
      paused: !timer.isRunning(),
      allowPlayerInput: document.querySelector('#allowPlayerInput').checked,
      usedLetters: sharedSession?.usedLetters || {},
      usedLettersForIndex: game.activeIndex,
      notice: sharedSession?.notice || null,
      revision: remoteRevision
    };
  }

  async function createParticipantLink() {
    if (!game || gameMode !== 'host') return;
    const button = document.querySelector('#shareParticipantButton');
    button.disabled = true;
    try {
      if (!sharedSession) {
        const response = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: getSharedState() }) });
        if (!response.ok) throw new Error('No se pudo crear la vista');
        const created = await response.json();
        sharedSession = { id: created.id, hostKey: created.hostKey, usedLetters: {}, notice: null };
        remoteRevision = created.state.revision;
        startSharedSync();
      }
      const link = `${window.location.origin}/?view=participant&session=${sharedSession.id}`;
      const linkBox = document.querySelector('#participantLinkBox');
      const linkInput = document.querySelector('#participantLink');
      linkInput.value = link;
      linkBox.hidden = false;
      let copied = false;
      try {
        await navigator.clipboard.writeText(link);
        copied = true;
      } catch {
        linkInput.focus();
        linkInput.select();
      }
      document.querySelector('#connectionStatus').textContent = copied
        ? 'Enlace copiado · Vista sincronizada'
        : 'Enlace generado · Pulsa Copiar';
      button.textContent = 'Copiar enlace del participante';
    } catch (error) {
      document.querySelector('#connectionStatus').textContent = 'No se pudo crear la vista sincronizada. Intenta de nuevo.';
      console.error('Error al crear la vista del participante', error);
    } finally { button.disabled = false; }
  }

  async function pushSharedState() {
    if (!sharedSession || !game) return;
    if (sharedRequestInFlight) {
      sharedPushPending = true;
      return;
    }
    sharedRequestInFlight = true;
    try {
      const response = await fetch(`/api/sessions/${sharedSession.id}`, {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-host-key': sharedSession.hostKey },
        body: JSON.stringify({ state: getSharedState() })
      });
      if (response.ok) {
        remoteRevision = (await response.json()).revision;
      } else if (response.status === 409) {
        const conflict = await response.json();
        if (conflict.state) applyRemoteState(conflict.state);
      }
      saveActiveGame();
    } catch { document.querySelector('#connectionStatus').textContent = 'Reconectando…'; }
    finally {
      sharedRequestInFlight = false;
      if (sharedPushPending) {
        sharedPushPending = false;
        queueMicrotask(pushSharedState);
      }
    }
  }

  async function pullSharedState() {
    if (!sharedSession || !game || sharedRequestInFlight) return;
    sharedRequestInFlight = true;
    try {
      const response = await fetch(`/api/sessions/${sharedSession.id}`);
      if (!response.ok) return;
      const state = await response.json();
      document.querySelector('#connectionStatus').textContent = 'Vista del participante conectada';
      if (state.revision > remoteRevision) applyRemoteState(state);
    } catch { document.querySelector('#connectionStatus').textContent = 'Reconectando…'; }
    finally {
      sharedRequestInFlight = false;
      if (sharedPushPending) {
        sharedPushPending = false;
        queueMicrotask(pushSharedState);
      }
    }
  }

  function applyRemoteState(state) {
    if (!state || !game || state.revision < remoteRevision) return;
    const previousActiveIndex = game.activeIndex;
    remoteRevision = state.revision;
    const remoteTurnLetters = state.usedLettersForIndex === state.activeIndex ? (state.usedLetters || {}) : {};
    sharedSession.usedLetters = remoteTurnLetters;
    sharedSession.notice = state.notice || null;
    if (state.notice && state.notice.id !== lastHostNoticeId) {
      lastHostNoticeId = state.notice.id;
      ui.showToast(state.notice.message, state.notice.type);
    }
    state.cards.forEach((card, index) => {
      game.cards[index].attempts = card.attempts;
      game.cards[index].revealedPositions = [...card.revealedPositions];
      game.cards[index].solved = card.solved;
    });
    game.activeIndex = state.activeIndex;
    // A poll may complete after a local tap. Never let an older keyboard snapshot
    // erase a letter already accepted in the current turn.
    hostUsedLetters = state.activeIndex === previousActiveIndex
      ? { ...hostUsedLetters, ...remoteTurnLetters }
      : { ...remoteTurnLetters };
    game.finished = state.finished;
    timer.remaining = state.remaining;
    timer.emitTick();
    ui.renderGame(game, handlers);
    saveActiveGame();
  }

  function startSharedSync() {
    window.clearInterval(syncTimer);
    // Host writes happen only when its state actually changes. Polling is read-only,
    // so a stale periodic write can no longer overwrite a recent key press.
    syncTimer = window.setInterval(pullSharedState, 700);
  }

  function stopSharedSync() {
    window.clearInterval(syncTimer);
    syncTimer = null;
    sharedSession = null;
    remoteRevision = 0;
    sharedRequestInFlight = false;
    sharedPushPending = false;
  }

  function toggleManualPause() {
    if (!game || game.finished || gameMode !== 'host') return;
    if (timer.isRunning()) { timer.stop(); ui.timer.classList.add('is-paused'); ui.setMessage('Partida pausada por el anfitrión.'); }
    else if (timer.remaining > 0) { timer.start(); ui.timer.classList.remove('is-paused'); ui.setMessage('Partida reanudada.'); }
    pushSharedState();
  }

  function startGame(event) {
    event.preventDefault();
    const entries = entryMode === 'paste'
      ? ui.parseQuickEntries(document.querySelector('#wordsTextarea').value)
      : ui.getSequentialEntries();
    if (!ui.validateWords(entryMode, entries)) return;
    game = new namespace.Game(entries);
    hostUsedLetters = {};
    pausedByVisibility = false;
    currentAnswer = '';
    timer.setInitial(initialTime);
    ui.setGameMode(gameMode);
    document.querySelector('#hostShareBar').hidden = gameMode !== 'host';
    ui.renderGame(game, handlers);
    ui.setMessage(gameMode === 'host'
      ? 'La primera palabra es la guía. El anfitrión controla la partida.'
      : 'La primera palabra es la guía. Completa la palabra 2 con el teclado.');
    ui.showScreen('game');
    timer.start();
    saveActiveGame();
  }

  function restartGame() {
    if (!game) return;
    game.reset();
    hostUsedLetters = {};
    pausedByVisibility = false;
    currentAnswer = '';
    timer.reset();
    ui.renderGame(game, handlers);
    ui.setMessage('Partida reiniciada con las mismas ocho palabras.');
    timer.start();
    pushSharedState();
    saveActiveGame();
  }

  function goHome(event) {
    if (event) event.preventDefault();
    timer.stop();
    pausedByVisibility = false;
    game = null;
    currentAnswer = '';
    stopSharedSync();
    localStorage.removeItem(SAVE_KEY);
    document.querySelector('#hostShareBar').hidden = true;
    ui.setMessage('');
    ui.showScreen('setup');
  }

  async function initParticipantView() {
    document.body.classList.add('participant-view');
    document.querySelector('.topbar').hidden = true;
    ui.setupScreen.hidden = true;
    ui.gameScreen.hidden = false;
    ui.gameScreen.classList.add('is-active');
    document.querySelector('#gameTitle').textContent = 'Tablero del participante';
    document.querySelector('.eyebrow').textContent = 'Conecta 8 en vivo';
    ui.keyboard.hidden = false;
    ui.hostControls.hidden = true;
    let participantActiveIndex = -1;
    let participantHasRendered = false;
    let participantInputPending = false;
    const render = (state) => {
      if (state.activeIndex !== participantActiveIndex) participantActiveIndex = state.activeIndex;
      ui.updateTimer(state.remaining);
      ui.timer.classList.toggle('is-paused', state.paused);
      ui.setMessage(state.finished ? '¡Partida completada!' : state.paused ? 'Partida en pausa' : `Palabra ${Math.min(state.activeIndex + 1, 8)} de 8`);
      const fragment = document.createDocumentFragment();
      state.cards.forEach((card, index) => {
        const row = document.createElement('article');
        row.className = `game-card ${card.solved ? 'is-solved' : index === state.activeIndex ? 'is-active' : 'is-locked'}`;
        const number = document.createElement('span'); number.className = 'card-number'; number.textContent = `${index + 1}.`;
        const word = document.createElement('div'); word.className = card.solved ? 'solved-word' : 'masked-word';
        word.textContent = card.visibleLetters.map((letter) => letter || '_').join(' ');
        const attempts = document.createElement('span'); attempts.className = 'attempts'; attempts.textContent = card.solved ? '✓' : `Intentos ${card.attempts}/3`;
        row.append(number, word, attempts); fragment.append(row);
      });
      ui.cardsGrid.replaceChildren(fragment);
      renderParticipantKeyboard(state);
      if (!participantHasRendered) {
        lastParticipantNoticeId = state.notice?.id || 0;
        participantHasRendered = true;
      } else if (state.notice && state.notice.id !== lastParticipantNoticeId) {
        lastParticipantNoticeId = state.notice.id;
        ui.showToast(state.notice.message, state.notice.type);
      }
    };
    const refresh = async () => {
      try {
        const response = await fetch(`/api/sessions/${participantSessionId}`);
        if (!response.ok) throw new Error();
        render(await response.json());
      } catch { ui.setMessage('No se pudo conectar con la partida.', 'danger'); }
    };
    const renderParticipantKeyboard = (state) => {
      const fragment = document.createDocumentFragment();
      ['QWERTYUIOP', 'ASDFGHJKLÑ', 'ZXCVBNM'].forEach((letters) => {
        const row = document.createElement('div'); row.className = 'keyboard-row';
        letters.split('').forEach((letter) => {
          const key = document.createElement('button'); key.className = 'keyboard-key'; key.type = 'button'; key.textContent = letter;
          const turnLetters = state.usedLettersForIndex === state.activeIndex ? (state.usedLetters || {}) : {};
          const activeCard = state.cards[state.activeIndex];
          const visibleLetters = new Set((activeCard?.visibleLetters || []).filter(Boolean));
          const canRevealLetter = (activeCard?.availableLetters || []).includes(letter);
          const fullyRevealed = visibleLetters.has(letter) && !canRevealLetter;
          key.disabled = participantInputPending || !state.allowPlayerInput || state.paused || state.finished || fullyRevealed || Boolean(turnLetters[letter]);
          if (fullyRevealed && !turnLetters[letter]) key.classList.add('is-revealed');
          if (turnLetters[letter]) key.classList.add(`is-${turnLetters[letter]}`);
          key.addEventListener('click', async () => {
            if (participantInputPending) return;
            participantInputPending = true;
            renderParticipantKeyboard(state);
            try {
              let nextState = await sendParticipantLetter(letter);
              const wasAccepted = nextState.activeIndex !== state.activeIndex
                || Boolean(nextState.usedLetters?.[letter])
                || (nextState.cards[nextState.activeIndex]?.visibleLetters || []).includes(letter);
              if (!wasAccepted) nextState = await sendParticipantLetter(letter);
              render(nextState);
            } catch { ui.showToast('No se pudo registrar la letra', 'penalty'); }
            finally { participantInputPending = false; await refresh(); }
          });
          row.append(key);
        }); fragment.append(row);
      });
      ui.keyboard.replaceChildren(fragment);
      ui.keyboard.hidden = !state.allowPlayerInput;
    };
    const sendParticipantLetter = async (letter) => {
      const response = await fetch(`/api/sessions/${participantSessionId}/letter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ letter })
      });
      if (!response.ok) throw new Error();
      return response.json();
    };
    await refresh();
    window.setInterval(refresh, 700);
  }

  ui.createWordInputs(8);
  ui.updateTimer(namespace.SETTINGS.initialTime);
  const initialTimeInput = document.querySelector('#initialTimeInput');
  function formatInitialTime(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
  function setInitialTime(seconds) {
    initialTime = Math.min(3600, Math.max(15, Math.round(seconds)));
    initialTimeInput.value = formatInitialTime(initialTime);
    ui.updateTimer(initialTime);
    document.querySelectorAll('[data-time-preset]').forEach((button) => button.classList.toggle('is-active', Number(button.dataset.timePreset) === initialTime));
  }
  function changeInitialTime(delta) { setInitialTime(initialTime + delta); }
  function parseInitialTime(value) {
    const clean = value.trim();
    if (/^\d+:\d{1,2}$/.test(clean)) { const [minutes, seconds] = clean.split(':').map(Number); return minutes * 60 + Math.min(59, seconds); }
    const number = Number(clean.replace(/[^\d]/g, ''));
    return Number.isFinite(number) && number > 0 ? number * 60 : initialTime;
  }
  document.querySelector('#decreaseTime').addEventListener('click', () => changeInitialTime(-15));
  document.querySelector('#increaseTime').addEventListener('click', () => changeInitialTime(15));
  initialTimeInput.addEventListener('change', () => setInitialTime(parseInitialTime(initialTimeInput.value)));
  initialTimeInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); initialTimeInput.blur(); } });
  document.querySelectorAll('[data-time-preset]').forEach((button) => button.addEventListener('click', () => setInitialTime(Number(button.dataset.timePreset))));
  document.querySelectorAll('[data-entry-mode]').forEach((button) => button.addEventListener('click', () => {
    entryMode = button.dataset.entryMode;
    document.querySelectorAll('[data-entry-mode]').forEach((item) => {
      item.classList.toggle('is-active', item === button);
      item.setAttribute('aria-selected', String(item === button));
    });
    document.querySelector('#sequentialEntryPanel').hidden = entryMode !== 'sequential';
    document.querySelector('#pasteEntryPanel').hidden = entryMode !== 'paste';
    ui.setupError.textContent = '';
  }));
  document.querySelectorAll('[data-game-mode]').forEach((button) => button.addEventListener('click', () => {
    gameMode = button.dataset.gameMode;
    document.querySelectorAll('[data-game-mode]').forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
  }));
  document.querySelector('#pauseOnHidden').addEventListener('change', (event) => {
    pauseOnHidden = event.target.checked;
  });
  const wordsTextarea = document.querySelector('#wordsTextarea');
  document.querySelector('#clearWordsButton').addEventListener('click', () => { wordsTextarea.value = ''; wordsTextarea.focus(); });
  document.querySelector('#copyWordsButton').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(wordsTextarea.value); ui.setupError.textContent = 'Lista copiada.'; }
    catch { ui.setupError.textContent = 'No se pudo copiar automáticamente.'; }
  });
  document.querySelector('#pasteWordsButton').addEventListener('click', async () => {
    try { wordsTextarea.value = await navigator.clipboard.readText(); ui.setupError.textContent = 'Lista pegada.'; }
    catch { wordsTextarea.focus(); ui.setupError.textContent = 'Mantén pulsado el cuadro y selecciona Pegar.'; }
  });
  const aiInstruction = 'Crea una cadena de exactamente 8 palabras en español para un juego de asociación. La primera palabra será visible y cada palabra siguiente debe relacionarse claramente con la anterior. Devuelve únicamente 8 líneas, sin numeración ni explicaciones. Usa este formato exacto en cada línea: PALABRA | definición breve que no mencione la palabra. No repitas palabras.';
  document.querySelector('#copyAiInstruction').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(aiInstruction); ui.setupError.textContent = 'Instrucción para la IA copiada.'; }
    catch { ui.setupError.textContent = 'No se pudo copiar automáticamente.'; }
  });
  document.querySelector('#setupForm').addEventListener('submit', startGame);
  document.querySelector('#restartButton').addEventListener('click', restartGame);
  document.querySelector('#homeButton').addEventListener('click', goHome);
  document.querySelector('#homeNavButton').addEventListener('click', goHome);
  document.querySelector('#shareParticipantButton').addEventListener('click', createParticipantLink);
  document.querySelector('#copyParticipantLinkButton').addEventListener('click', async () => {
    const input = document.querySelector('#participantLink');
    if (!input.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
      document.querySelector('#connectionStatus').textContent = 'Enlace copiado · Vista sincronizada';
    } catch {
      input.focus();
      input.select();
      document.querySelector('#connectionStatus').textContent = 'Enlace seleccionado · Usa Copiar en tu dispositivo';
    }
  });
  document.querySelector('#allowPlayerInput').addEventListener('change', (event) => {
    announce(event.target.checked ? 'Teclado del participante habilitado' : 'Teclado del participante bloqueado');
    pushSharedState();
  });
  ui.timer.addEventListener('click', toggleManualPause);
  document.addEventListener('keydown', (event) => {
    if (!game || game.finished || gameMode !== 'individual' || event.target instanceof HTMLInputElement) return;
    const key = event.key.toUpperCase();
    if (key === 'ENTER') handlers.onKey('ENTER');
    else if (key === 'BACKSPACE') handlers.onKey('BORRAR');
    else if (/^[A-ZÑ]$/.test(key)) handlers.onKey(key);
    else return;
    event.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (pauseOnHidden && game && !game.finished && timer.isRunning()) {
        timer.stop();
        pausedByVisibility = true;
      }
      return;
    }
    if (pausedByVisibility && game && !game.finished) {
      ui.showVisibilityPause(handlers.onResumeVisibility);
    }
  });
  function saveActiveGame() {
    if (isParticipantView || !game) return;
    const payload = { entries: game.entries, cards: game.cards, activeIndex: game.activeIndex, finished: game.finished, remaining: timer.remaining, initialTime, gameMode, pauseOnHidden, sharedSession, remoteRevision, allowPlayerInput: document.querySelector('#allowPlayerInput').checked, savedAt: Date.now() };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(payload)); } catch { /* El juego continúa aunque el almacenamiento esté lleno. */ }
  }

  function restoreActiveGame() {
    if (isParticipantView) return false;
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!saved?.entries?.length || saved.finished) return false;
      game = new namespace.Game(saved.entries);
      game.cards = saved.cards;
      game.activeIndex = saved.activeIndex;
      game.finished = false;
      initialTime = saved.initialTime || 60;
      gameMode = saved.gameMode === 'host' ? 'host' : 'individual';
      pauseOnHidden = saved.pauseOnHidden !== false;
      sharedSession = saved.sharedSession || null;
      noticeSequence = Math.max(noticeSequence, Number(sharedSession?.notice?.id) || 0);
      remoteRevision = saved.remoteRevision || 0;
      timer.setInitial(initialTime);
      timer.remaining = Math.max(0, Number(saved.remaining) || initialTime);
      timer.emitTick();
      ui.setGameMode(gameMode);
      document.querySelector('#hostShareBar').hidden = gameMode !== 'host';
      document.querySelector('#allowPlayerInput').checked = saved.allowPlayerInput !== false;
      ui.renderGame(game, handlers);
      ui.showScreen('game');
      ui.setMessage('Partida recuperada. Toca el tiempo para continuar.', 'success');
      ui.timer.classList.add('is-paused');
      if (sharedSession?.id && sharedSession?.hostKey) {
        const link = `${window.location.origin}/?view=participant&session=${sharedSession.id}`;
        document.querySelector('#participantLink').value = link;
        document.querySelector('#participantLinkBox').hidden = false;
        document.querySelector('#shareParticipantButton').textContent = 'Copiar enlace del participante';
        startSharedSync();
      }
      return true;
    } catch { localStorage.removeItem(SAVE_KEY); return false; }
  }

  setInitialTime(initialTime);
  if (isParticipantView) initParticipantView();
  else restoreActiveGame();
})(window.Conecta8 = window.Conecta8 || {});
