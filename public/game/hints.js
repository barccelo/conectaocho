(function (namespace) {
  'use strict';

  const isHiddenCharacter = (character) => /[\p{L}\p{N}]/u.test(character);

  function buildMask(word, revealedPositions) {
    const revealed = new Set(revealedPositions);
    let letterPosition = -1;
    return Array.from(word).map((character) => {
      if (!isHiddenCharacter(character)) return character;
      letterPosition += 1;
      return revealed.has(letterPosition) ? character.toUpperCase() : '_';
    }).join(' ');
  }

  function initialRevealCount(word) {
    return Array.from(word).some(isHiddenCharacter) ? 1 : 0;
  }

  function buildEntryMask(word, revealedPositions, answer) {
    const revealed = new Set(revealedPositions);
    const typedCharacters = Array.from(answer.toUpperCase());
    let letterPosition = -1;
    let typedPosition = 0;
    return Array.from(word).map((character) => {
      if (!isHiddenCharacter(character)) return character;
      letterPosition += 1;
      if (revealed.has(letterPosition)) return character.toUpperCase();
      const typed = typedCharacters[typedPosition];
      typedPosition += 1;
      return typed || '_';
    }).join(' ');
  }

  function playableLength(word) {
    return Array.from(word).filter(isHiddenCharacter).length;
  }

  namespace.Hints = { buildMask, buildEntryMask, initialRevealCount, playableLength };
})(window.Conecta8 = window.Conecta8 || {});
