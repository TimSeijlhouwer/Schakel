import { supabase } from "../supabaseClient";

// --- acties (roepen de beveiligde database-functies aan) ---
export async function startGameRpc(gameId, wordsPer) {
  const { error } = await supabase.rpc("start_game", { p_game_id: gameId, p_words_per: wordsPer });
  if (error) throw error;
}
export async function submitClue(gameId, word, number) {
  const { error } = await supabase.rpc("submit_clue", { p_game_id: gameId, p_word: word, p_number: number });
  if (error) throw error;
}
export async function submitGuess(gameId, wordIdxs) {
  const { error } = await supabase.rpc("submit_guess", { p_game_id: gameId, p_word_idxs: wordIdxs });
  if (error) throw error;
}
export async function resolveTurn(gameId) {
  const { error } = await supabase.rpc("resolve_turn", { p_game_id: gameId });
  if (error) throw error;
}
export async function nextTurn(gameId) {
  const { error } = await supabase.rpc("next_turn", { p_game_id: gameId });
  if (error) throw error;
}
export async function endGameRpc(gameId) {
  const { error } = await supabase.rpc("end_game", { p_game_id: gameId });
  if (error) throw error;
}

// --- ophalen van de huidige toestand ---
// mySecrets bevat door de beveiliging alleen JOUW eigen geheime woorden.
export async function fetchSnapshot(gameId) {
  const [g, p, w, s] = await Promise.all([
    supabase.from("games").select("*").eq("id", gameId).single(),
    supabase.from("players").select("*").eq("game_id", gameId).order("joined_at"),
    supabase.from("words").select("idx,text").eq("game_id", gameId).order("idx"),
    supabase.from("secret_words").select("word_idx,found").eq("game_id", gameId),
  ]);
  return {
    game: g.data,
    players: p.data || [],
    words: w.data || [],
    mySecrets: s.data || [],
  };
}

export async function fetchTurnGuesses(gameId, turnNumber) {
  const { data } = await supabase
    .from("guesses")
    .select("rater_id,word_idx,correct")
    .eq("game_id", gameId)
    .eq("turn_number", turnNumber);
  return data || [];
}
