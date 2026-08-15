(function (namespace) {
  'use strict';

  class UI {
    constructor() {
      this.setupScreen = document.querySelector('#setupScreen');
      this.gameScreen = document.querySelector('#gameScreen');
      this.inputsContainer = document.querySelector('#wordInputs');
      this.cardsGrid = document.querySelector('#cardsGrid');
      this.keyboard = document.querySelector('#onscreenKeyboard');
      this.hostControls = document.querySelector('#hostControls');
      this.gameMode = 'individual';
      this.setupError = document.querySelector('#setupError');
      this.gameMessage = document.querySelector('#gameMessage');
      this.timer = document.querySelector('#timer');
      this.timerValue = document.querySelector('#timerValue');
      this.restartButton = document.querySelector('#restartButton');
      this.hintOverlay = document.querySelector('#hintOverlay');
      this.hintDialogTitle = document.querySelector('#hintDialogTitle');
      this.hintDialogText = document.querySelector('#hintDialogText');
      this.hintDialogIcon = document.querySelector('#hintDialogIcon');
      this.hintDialogActions = document.querySelector('#hintDialogActions');
      this.toast = document.querySelector('#gameToast');
      this.toastTimer = null;
      this.toastHideTimer = null;
    }

    setGameMode(mode) { this.gameMode = mode === 'host' ? 'host' : 'individual'; }

    createWordInputs(count) {
      const fragment = document.createDocumentFragment();
      for (let index = 0; index < count; index += 1) {
        const field = document.createElement('div');
        field.className = 'word-field';
        const label = document.createElement('label');
        label.htmlFor = `word-${index}`;
        label.textContent = `Palabra ${index + 1}`;
        const input = document.createElement('input');
        input.id = `word-${index}`;
        input.name = `word-${index}`;
        input.type = 'text';
        input.autocomplete = 'off';
        input.maxLength = 40;
        input.required = true;
        field.append(label, input);
        fragment.append(field);
      }
      this.inputsContainer.replaceChildren(fragment);
    }

    getSequentialEntries() { return Array.from(this.inputsContainer.querySelectorAll('input'), (input) => ({ word: input.value.trim(), definition: '' })); }

    parseQuickEntries(text) {
      return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8).map((line) => {
        const separator = line.indexOf('|');
        return separator === -1
          ? { word: line, definition: '' }
          : { word: line.slice(0, separator).trim(), definition: line.slice(separator + 1).trim() };
      });
    }

    validateWords(mode, entries) {
      if (mode === 'paste') {
        const valid = entries.length === 8 && entries.every((entry) => entry.word);
        this.setupError.textContent = valid ? '' : 'Pega exactamente ocho palabras, una por línea.';
        return valid;
      }
      const inputs = Array.from(this.inputsContainer.querySelectorAll('input'));
      let firstInvalid = null;
      inputs.forEach((input) => {
        const invalid = input.value.trim() === '';
        input.setAttribute('aria-invalid', String(invalid));
        if (invalid && firstInvalid === null) firstInvalid = input;
      });
      this.setupError.textContent = firstInvalid ? 'Completa las ocho palabras para comenzar.' : '';
      if (firstInvalid) firstInvalid.focus();
      return firstInvalid === null;
    }

    showScreen(screenName) {
      const showSetup = screenName === 'setup';
      const incoming = showSetup ? this.setupScreen : this.gameScreen;
      const outgoing = showSetup ? this.gameScreen : this.setupScreen;
      outgoing.classList.remove('is-active');
      window.setTimeout(() => {
        outgoing.hidden = true;
        incoming.hidden = false;
        window.requestAnimationFrame(() => incoming.classList.add('is-active'));
      }, 170);
      this.restartButton.hidden = showSetup;
    }

    renderGame(game, handlers) {
      const fragment = document.createDocumentFragment();
      game.cards.forEach((card, index) => fragment.append(this.createCard(game, card, index, handlers)));
      if (!game.finished) {
        const hintButton = document.createElement('button');
        hintButton.className = 'floating-hint';
        hintButton.type = 'button';
        hintButton.setAttribute('aria-label', 'Abrir opciones de pista');
        hintButton.innerHTML = '<span aria-hidden="true">💡</span><small>PISTA</small>';
        hintButton.addEventListener('click', handlers.onOpenHints);
        fragment.append(hintButton);
      }
      this.cardsGrid.replaceChildren(fragment);
      const hostMode = this.gameMode === 'host';
      this.keyboard.hidden = hostMode;
      this.hostControls.hidden = !hostMode;
      if (hostMode) this.renderHostControls(handlers, game.finished, game, window.Conecta8HostUsedLetters?.() || {});
      else this.renderKeyboard(handlers, game.finished);
    }

    createCard(game, card, index, handlers) {
      const article = document.createElement('article');
      article.className = `game-card ${card.solved ? 'is-solved' : index === game.activeIndex && !game.finished ? 'is-active' : 'is-locked'}${card.isSeed ? ' is-seed' : ''}`;
      article.dataset.index = String(index);

      if (card.solved) {
        const number = document.createElement('span');
        number.className = 'card-number';
        number.textContent = `${index + 1}.`;
        const word = document.createElement('div');
        word.className = 'solved-word';
        word.textContent = card.word.toUpperCase();
        const check = document.createElement('div');
        check.className = 'solved-check';
        check.textContent = card.isSeed ? 'INICIAL' : '+10 s';
        article.append(number, word, check);
        return article;
      }

      const enabled = index === game.activeIndex && !game.finished;
      const number = document.createElement('span');
      number.className = 'card-number';
      number.textContent = `${index + 1}.`;
      const mask = document.createElement('div');
      mask.className = 'masked-word';
      if (this.gameMode === 'host' && enabled) {
        const revealed = new Set(card.revealedPositions);
        let position = -1;
        Array.from(card.word).forEach((character) => {
          if (!/[\p{L}\p{N}]/u.test(character)) {
            const separator = document.createElement('span');
            separator.className = 'letter-separator';
            separator.textContent = character;
            mask.append(separator);
            return;
          }
          position += 1;
          const box = document.createElement('button');
          box.type = 'button';
          box.className = `letter-box${revealed.has(position) ? ' is-revealed' : ''}`;
          box.textContent = revealed.has(position) ? character.toUpperCase() : '';
          box.disabled = revealed.has(position);
          box.setAttribute('aria-label', revealed.has(position) ? `Letra ${character}` : `Revelar letra ${position + 1}`);
          const selectedPosition = position;
          box.addEventListener('click', () => handlers.onHostRevealPosition(selectedPosition));
          mask.append(box);
        });
      } else mask.textContent = game.getMask(index);
      const attempts = document.createElement('span');
      attempts.className = 'attempts';
      attempts.textContent = `Intentos ${card.attempts}/3`;
      article.append(number, mask, attempts);
      return article;
    }

    renderKeyboard(handlers, disabled) {
      const rows = [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
        ['ENTER', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'BORRAR']
      ];
      const fragment = document.createDocumentFragment();
      rows.forEach((keys) => {
        const row = document.createElement('div');
        row.className = 'keyboard-row';
        keys.forEach((key) => {
          const button = document.createElement('button');
          button.className = `keyboard-key${key.length > 1 ? ' is-wide' : ''}`;
          button.type = 'button';
          button.disabled = disabled;
          button.textContent = key === 'BORRAR' ? '⌫' : key;
          button.setAttribute('aria-label', key === 'BORRAR' ? 'Borrar letra' : key === 'ENTER' ? 'Comprobar respuesta' : `Letra ${key}`);
          button.addEventListener('click', () => handlers.onKey(key));
          row.append(button);
        });
        fragment.append(row);
      });
      this.keyboard.replaceChildren(fragment);
      this.keyboard.classList.toggle('is-disabled', disabled);
    }

    renderHostControls(handlers, disabled, game, usedLetters = {}) {
      const approve = document.createElement('button');
      approve.className = 'host-control is-approve';
      approve.type = 'button';
      approve.disabled = disabled;
      approve.innerHTML = '<span class="host-swipe-guide" aria-hidden="true"><b>↑</b> DESLIZA PARA REVELAR PALABRA</span><span class="host-control-symbol" aria-hidden="true">✓</span><strong class="host-approve-title">Revelar letra</strong><small class="host-approve-help">Toca una vez</small><span class="host-swipe-status" aria-hidden="true">Sigue deslizando…</span>';
      approve.setAttribute('aria-label', 'Tocar para revelar la siguiente letra. Deslizar hacia arriba o mantener pulsado y soltar para revelar la palabra completa.');

      const reject = document.createElement('button');
      reject.className = 'host-control is-reject';
      reject.type = 'button';
      reject.disabled = disabled;
      reject.innerHTML = '<span class="host-control-symbol" aria-hidden="true">×</span><strong>Intento fallido</strong><small>Al tercero se restan 5 segundos</small>';
      reject.setAttribute('aria-label', 'Registrar un intento fallido');
      reject.addEventListener('click', handlers.onHostWrong);

      let startY = 0;
      let longPressTimer = null;
      let swipeArmed = false;
      let moved = false;
      const swipeDistance = 64;
      const clearGesture = () => {
        window.clearTimeout(longPressTimer);
        approve.classList.remove('is-dragging', 'is-armed');
        approve.style.setProperty('--swipe-progress', '0');
      };
      approve.addEventListener('pointerdown', (event) => {
        startY = event.clientY;
        swipeArmed = false;
        moved = false;
        approve.classList.add('is-dragging');
        approve.setPointerCapture?.(event.pointerId);
        longPressTimer = window.setTimeout(() => {
          swipeArmed = true;
          approve.classList.add('is-armed');
          approve.style.setProperty('--swipe-progress', '1');
          navigator.vibrate?.(30);
        }, 700);
      });
      approve.addEventListener('pointermove', (event) => {
        const distance = Math.max(0, startY - event.clientY);
        moved = moved || Math.abs(startY - event.clientY) > 10;
        const progress = Math.min(1, distance / swipeDistance);
        approve.style.setProperty('--swipe-progress', String(progress));
        if (progress >= 1 && !swipeArmed) {
          swipeArmed = true;
          window.clearTimeout(longPressTimer);
          approve.classList.add('is-armed');
          navigator.vibrate?.(30);
        } else if (progress < 1 && swipeArmed) {
          swipeArmed = false;
          approve.classList.remove('is-armed');
        }
      });
      approve.addEventListener('pointerup', () => {
        window.clearTimeout(longPressTimer);
        if (swipeArmed) handlers.onHostSolve();
        else if (!moved) {
          handlers.onHostReveal();
        }
        window.setTimeout(clearGesture, 120);
      });
      approve.addEventListener('pointercancel', clearGesture);
      approve.addEventListener('contextmenu', (event) => event.preventDefault());

      const letters = document.createElement('div');
      letters.className = 'host-letter-keyboard';
      const hostRows = ['QWERTYUIOP', 'ASDFGHJKLÑ', 'ZXCVBNM'];
      const card = game && !game.finished ? game.cards[game.activeIndex] : null;
      const lettersInWord = card ? Array.from(card.word).filter((character) => /[\p{L}\p{N}]/u.test(character)) : [];
      const normalizedLetters = lettersInWord.map((letter) => letter.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase());
      const revealedPositions = new Set(card?.revealedPositions || []);
      hostRows.forEach((rowLetters) => {
        const row = document.createElement('div');
        row.className = 'host-keyboard-row';
        rowLetters.split('').forEach((letter) => {
          const key = document.createElement('button');
          key.type = 'button';
          key.textContent = letter;
          const hasOccurrence = normalizedLetters.includes(letter);
          const hasHiddenOccurrence = normalizedLetters.some((wordLetter, position) => wordLetter === letter && !revealedPositions.has(position));
          const fullyRevealed = hasOccurrence && !hasHiddenOccurrence;
          key.disabled = disabled || fullyRevealed || Boolean(usedLetters[letter]);
          if (fullyRevealed && !usedLetters[letter]) key.classList.add('is-revealed');
          if (usedLetters[letter]) key.classList.add(`is-${usedLetters[letter]}`);
          key.addEventListener('click', () => handlers.onHostLetter(letter));
          row.append(key);
        });
        letters.append(row);
      });
      this.hostControls.replaceChildren(approve, reject, letters);
    }

    updateActiveEntry(game, answer) {
      if (game.finished) return;
      const mask = this.cardsGrid.querySelector(`[data-index="${game.activeIndex}"] .masked-word`);
      if (mask) mask.textContent = game.getEntryMask(game.activeIndex, answer);
    }

    openHintMenu(hasDefinition, handlers) {
      this.hintDialogIcon.textContent = '💡';
      this.hintDialogTitle.textContent = 'Elige una pista';
      this.hintDialogText.textContent = 'El reloj está pausado mientras eliges.';
      this.hintDialogActions.replaceChildren(
        this.hintAction('Secuencial', 'Siguiente letra · −5 s', () => handlers.onChooseHint('sequential')),
        this.hintAction('Aleatoria', 'Cualquier letra · −10 s', () => handlers.onChooseHint('random')),
        this.hintAction('Definición', hasDefinition ? 'Ver definición · −15 s' : 'No disponible', () => handlers.onChooseHint('definition'), !hasDefinition),
        this.hintAction('Cancelar', 'Volver al juego', handlers.onCloseHints, false, 'is-secondary')
      );
      this.hintOverlay.hidden = false;
      document.body.classList.add('modal-open');
    }

    showHintConfirmation(type, cost, handlers) {
      const names = { sequential: 'pista secuencial', random: 'pista aleatoria', definition: 'pista de definición' };
      this.hintDialogIcon.textContent = '⏱️';
      this.hintDialogTitle.textContent = '¿Estás seguro?';
      this.hintDialogText.textContent = `La ${names[type]} restará ${cost} segundos.`;
      this.hintDialogActions.replaceChildren(
        this.hintAction(`Usar pista · −${cost} s`, 'Confirmar', handlers.onConfirmHint),
        this.hintAction('Volver', 'Elegir otra pista', handlers.onBackToHints, false, 'is-secondary')
      );
    }

    showDefinition(definition, onContinue) {
      this.hintDialogIcon.textContent = '📖';
      this.hintDialogTitle.textContent = 'Pista de definición';
      this.hintDialogText.textContent = definition;
      this.hintDialogActions.replaceChildren(this.hintAction('Continuar', 'Reanudar el tiempo', onContinue));
    }

    showTimeUp(onRestart, onHome) {
      this.hintDialogIcon.textContent = '⏰';
      this.hintDialogTitle.textContent = 'Se acabó el tiempo';
      this.hintDialogText.textContent = 'La partida terminó, pero puedes intentarlo nuevamente con las mismas palabras.';
      this.hintDialogActions.replaceChildren(
        this.hintAction('Reiniciar partida', 'Conservar las ocho palabras', () => { this.closeHintDialog(); onRestart(); }),
        this.hintAction('Volver al inicio', 'Preparar otra partida', () => { this.closeHintDialog(); onHome(); }, false, 'is-secondary')
      );
      this.hintOverlay.hidden = false;
      document.body.classList.add('modal-open');
    }

    showVisibilityPause(onContinue) {
      this.hintDialogIcon.textContent = '⏸️';
      this.hintDialogTitle.textContent = 'Partida en pausa';
      this.hintDialogText.textContent = 'El temporizador se detuvo porque saliste de la pestaña.';
      this.hintDialogActions.replaceChildren(
        this.hintAction('Continuar partida', 'Reanudar el temporizador', onContinue)
      );
      this.hintOverlay.hidden = false;
      document.body.classList.add('modal-open');
    }

    closeHintDialog() {
      this.hintOverlay.hidden = true;
      document.body.classList.remove('modal-open');
    }

    hintAction(title, detail, onClick, disabled = false, extraClass = '') {
      const button = document.createElement('button');
      button.className = `hint-choice ${extraClass}`.trim();
      button.type = 'button';
      button.disabled = disabled;
      button.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
      button.addEventListener('click', onClick);
      return button;
    }

    animateWrong(cardElement) {
      if (!cardElement) return;
      cardElement.classList.remove('is-wrong');
      void cardElement.offsetWidth;
      cardElement.classList.add('is-wrong');
      window.setTimeout(() => cardElement.classList.remove('is-wrong'), 350);
    }

    updateTimer(seconds) {
      const safeSeconds = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
      const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
      const remainder = Math.floor(safeSeconds % 60).toString().padStart(2, '0');
      this.timerValue.textContent = `${minutes}:${remainder}`;
      this.timer.classList.toggle('is-low', safeSeconds <= 10);
    }

    setMessage(message, type = '') {
      this.gameMessage.textContent = message;
      this.gameMessage.className = `game-message${type ? ` is-${type}` : ''}`;
    }

    showToast(message, type = 'info', duration = 850) {
      window.clearTimeout(this.toastTimer);
      window.clearTimeout(this.toastHideTimer);
      this.toast.querySelector('.game-toast-icon').textContent = type === 'penalty' ? '−' : type === 'error' ? '×' : type === 'success' ? '✓' : '💡';
      this.toast.querySelector('.game-toast-text').textContent = message;
      this.toast.className = `game-toast is-${type}`;
      this.toast.hidden = false;
      void this.toast.offsetWidth;
      this.toast.classList.add('is-visible');
      this.toastTimer = window.setTimeout(() => {
        this.toast.classList.remove('is-visible');
        this.toastHideTimer = window.setTimeout(() => { this.toast.hidden = true; }, 220);
      }, Math.min(1000, Math.max(500, duration)));
    }
  }

  namespace.UI = UI;
})(window.Conecta8 = window.Conecta8 || {});
