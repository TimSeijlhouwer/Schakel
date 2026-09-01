import { supabase } from "../supabaseClient";
import { PLAYER_COLORS, MAX_PLAYERS, makeCode } from "./constants";

// Maak een nieuw spel aan en voeg de host meteen als eerste speler toe.
export async function createGame(userId, name) {
  // Probeer een paar keer voor het geval de code al bestaat.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode(4);
    const { data: game, error } = await supabase
      .from("games")
      .insert({ code, host_id: userId, status: "lobby" })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") continue; // unieke code botste, opnieuw
      throw error;
    }

    await supabase.from("players").insert({
      game_id: game.id,
      user_id: userId,
      name,
      color: PLAYER_COLORS[0],
    });

    return game;
  }
  throw new Error("Kon geen unieke spelcode maken. Probeer opnieuw.");
}

// Zoek een spel op code en voeg jezelf toe.
export async function joinGame(userId, name, rawCode) {
  const code = rawCode.trim().toUpperCase();
  const { data: game, error } = await supabase
    .from("games")
    .select()
    .eq("code", code)
    .maybeSingle();

  if (error) throw error;
  if (!game) throw new Error("Geen spel gevonden met die code.");
  if (game.status === "ended") throw new Error("Dit spel is al afgelopen.");

  const { data: existing } = await supabase
    .from("players")
    .select("id, user_id, color")
    .eq("game_id", game.id);

  const mine = existing?.find((p) => p.user_id === userId);

  // Al bezig? Alleen terugkomen als je er al in zat.
  if (game.status !== "lobby" && !mine) {
    throw new Error("Dit spel is al begonnen — je kunt alleen meedoen als je er al in zat.");
  }

  if (!mine) {
    if ((existing?.length ?? 0) >= MAX_PLAYERS) {
      throw new Error("Dit spel zit vol.");
    }
    const color = PLAYER_COLORS[(existing?.length ?? 0) % PLAYER_COLORS.length];
    const { error: joinErr } = await supabase
      .from("players")
      .insert({ game_id: game.id, user_id: userId, name, color });
    if (joinErr && joinErr.code !== "23505") throw joinErr;
  }

  return game;
}

export async function fetchPlayers(gameId) {
  const { data, error } = await supabase
    .from("players")
    .select("id, user_id, name, color, joined_at")
    .eq("game_id", gameId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// Host zet het spel op 'playing'. De echte spellogica komt in de volgende stap.
export async function startGame(gameId) {
  const { error } = await supabase
    .from("games")
    .update({ status: "playing" })
    .eq("id", gameId);
  if (error) throw error;
}
