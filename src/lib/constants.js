export const PLAYER_COLORS = [
  "#FF5C7A", "#35D6C4", "#FFC94A", "#8B7CF6", "#6FCF6B", "#F79C42",
];

export const MAX_PLAYERS = PLAYER_COLORS.length; // 6

// Korte, goed leesbare code zonder verwarrende tekens (geen 0/O, 1/I).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeCode(len = 4) {
  let s = "";
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}
