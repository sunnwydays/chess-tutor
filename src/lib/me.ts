/**
 * "This is me": the app takes any Chess.com username, so it can't know whether
 * the games belong to the viewer. The home page saves the viewer's own
 * username; a loaded account that matches it is "me" and coach wording uses
 * "you". Anything else is "the player". localStorage only, wrapped in try.
 */
const KEY = "me:username";

export function loadMe(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveMe(username: string | null) {
  try {
    if (username) localStorage.setItem(KEY, username.toLowerCase());
    else localStorage.removeItem(KEY);
  } catch {}
}

export function isMe(username: string): boolean {
  const me = loadMe();
  return !!me && me === username.toLowerCase();
}

/** Wording helpers so every chip/message agrees. */
export function who(me: boolean) {
  return {
    /** "you" / "the player" */
    subject: me ? "you" : "the player",
    /** "You" / "The player" */
    Subject: me ? "You" : "The player",
    /** "your" / "the player's" */
    possessive: me ? "your" : "the player's",
    /** "Your" / "The player's" */
    Possessive: me ? "Your" : "The player's",
    /** "You played" / "Played in the game" */
    played: me ? "You played" : "Played in the game",
    /** "Same move as you played" / "Same move as in the game" */
    sameMove: me ? "Same move as you played" : "Same move as in the game",
  };
}
