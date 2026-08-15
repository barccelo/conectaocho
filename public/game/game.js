(function (namespace) {
  'use strict';

  const SETTINGS = Object.freeze({ initialTime: 60, correctBonus: 10, errorPenalty: 5, sequentialHintPenalty: 5, randomHintPenalty: 10, definitionHintPenalty: 15, maxAttempts: 3 });

  const normalize = (value) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase('es');

  class Game {
    constructor(entries) {
      this.entries = entries.map((entry) => ({ word: entry.word.trim(), definition: (entry.definition || '').trim() }));
      this.words = this.entries.map((entry) => entry.word);
      this.reset();
    }

    reset() {
      this.activeIndex = 1;
      this.finished = false;
      this.cards = this.entries.map((entry, index) => ({
        word: entry.word,
        definition: entry.definition,
        attempts: 0,
        hintsUsed: { sequential: 0, random: 0, definition: 0 },
        revealedPositions: [0],
        solved: index === 0,
        isSeed: index === 0
      }));
    }

    submit(index, answer) {
      if (!this.canPlay(index)) return { type: 'ignored' };
      if (this.isCurrentAnswerCorrect(index, answer)) {
        return this.solveActive(index);
      }
      return this.recordFailure(index);
    }

    solveActive(index) {
      if (!this.canPlay(index)) return { type: 'ignored' };
      this.cards[index].solved = true;
      this.activeIndex += 1;
      this.finished = this.activeIndex >= this.cards.length;
      return { type: 'correct', timeChange: SETTINGS.correctBonus, finished: this.finished };
    }

    revealNextLetter(index) {
      if (!this.canPlay(index)) return { type: 'ignored' };
      const card = this.cards[index];
      const letters = Array.from(card.word).filter((character) => /[\p{L}\p{N}]/u.test(character));
      const position = letters.findIndex((_, letterIndex) => !card.revealedPositions.includes(letterIndex));
      if (position === -1) return this.solveActive(index);
      card.revealedPositions.push(position);
      card.revealedPositions.sort((a, b) => a - b);
      if (card.revealedPositions.length >= letters.length) return this.solveActive(index);
      return { type: 'revealed', position, timeChange: 0 };
    }

    revealPosition(index, position) {
      if (!this.canPlay(index)) return { type: 'ignored' };
      const card = this.cards[index];
      const total = Array.from(card.word).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
      if (position < 0 || position >= total || card.revealedPositions.includes(position)) return { type: 'ignored' };
      card.revealedPositions.push(position);
      card.revealedPositions.sort((a, b) => a - b);
      if (card.revealedPositions.length >= total) return this.solveActive(index);
      return { type: 'revealed', position, timeChange: 0 };
    }

    guessLetter(index, guessedLetter) {
      if (!this.canPlay(index)) return { type: 'ignored' };
      const normalizedGuess = normalize(guessedLetter);
      const card = this.cards[index];
      const letters = Array.from(card.word).filter((character) => /[\p{L}\p{N}]/u.test(character));
      const positions = letters.map((character, position) => ({ character, position }))
        .filter(({ character }) => normalize(character) === normalizedGuess)
        .map(({ position }) => position);
      if (!positions.length) return this.recordFailure(index);
      if (positions.every((position) => card.revealedPositions.includes(position))) return { type: 'already-revealed', timeChange: 0 };
      positions.forEach((position) => { if (!card.revealedPositions.includes(position)) card.revealedPositions.push(position); });
      card.revealedPositions.sort((a, b) => a - b);
      if (card.revealedPositions.length >= letters.length) return this.solveActive(index);
      return { type: 'letter-match', positions, timeChange: 0 };
    }

    recordFailure(index) {
      if (!this.canPlay(index)) return { type: 'ignored' };
      const card = this.cards[index];
      card.attempts += 1;
      if (card.attempts >= SETTINGS.maxAttempts) {
        card.attempts = 0;
        return { type: 'attempts-reset', timeChange: -SETTINGS.errorPenalty };
      }
      return { type: 'wrong', timeChange: 0 };
    }

    useHint(index, type) {
      if (!this.canPlay(index)) return { type: 'ignored' };
      const card = this.cards[index];
      if (type === 'definition') {
        if (!card.definition) return { type: 'unavailable' };
        card.hintsUsed.definition += 1;
        return { type: 'definition', definition: card.definition, timeChange: -SETTINGS.definitionHintPenalty };
      }
      const letters = Array.from(card.word).filter((character) => /[\p{L}\p{N}]/u.test(character));
      const unrevealed = letters.map((_, position) => position).filter((position) => !card.revealedPositions.includes(position));
      if (!unrevealed.length) return { type: 'unavailable' };
      const position = type === 'random'
        ? unrevealed[Math.floor(Math.random() * unrevealed.length)]
        : unrevealed[0];
      const removedEntryIndex = unrevealed.indexOf(position);
      card.revealedPositions.push(position);
      card.revealedPositions.sort((a, b) => a - b);
      card.hintsUsed[type] += 1;
      return {
        type: 'letter',
        removedEntryIndex,
        timeChange: type === 'random' ? -SETTINGS.randomHintPenalty : -SETTINGS.sequentialHintPenalty
      };
    }

    canPlay(index) { return !this.finished && index === this.activeIndex && !this.cards[index].solved; }
    end() { this.finished = true; }
    getMask(index) { return namespace.Hints.buildMask(this.cards[index].word, this.cards[index].revealedPositions); }
    getEntryMask(index, answer) { return namespace.Hints.buildEntryMask(this.cards[index].word, this.cards[index].revealedPositions, answer); }
    getAnswerLength(index) {
      const card = this.cards[index];
      return Math.max(0, namespace.Hints.playableLength(card.word) - card.revealedPositions.length);
    }
    getExpectedAnswer(index) {
      const card = this.cards[index];
      const letters = Array.from(card.word).filter((character) => /[\p{L}\p{N}]/u.test(character));
      return letters.filter((_, position) => !card.revealedPositions.includes(position)).join('');
    }
    isCurrentAnswerCorrect(index, answer) { return normalize(answer) === normalize(this.getExpectedAnswer(index)); }
    hasDefinition(index) { return Boolean(this.cards[index].definition); }
  }

  namespace.Game = Game;
  namespace.SETTINGS = SETTINGS;
})(window.Conecta8 = window.Conecta8 || {});
