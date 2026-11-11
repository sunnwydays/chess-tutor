# BRAINSTORM & TODO - 45 minutes

Based on my knowledge in chess, applied AI, and learning. And through what I've learned while making my AI Tutor project for teaching myself school content and tracking how I learn.

Transcripts in `C:\Users\iF3LL\.claude\projects\c--Users-iF3LL-Documents-code-grind-ML-chess-tutor\<session-id>.jsonl`

## Core

- The LLM explains, the engine judges. That split is the main design point
- At a high level, address the bottleneck. Only prioritize teaching what's important to the player, their most common mistakes, and, within a game, the most impactful problems. 
- At a lower level, we're going to use a hint ladder. The user recalls, and then we also have spaced repetition To cement learning; What you've seen in games so far is often what you'll continue to see. You won't see the rare positions where you're making the mistakes. . They give their candidate moves, and briefly describe each one. That way, we can analyze how they're thinking, not just what move they played, so we understand how they think. This is like a test for them. Anchors what they think because, in an actual game, you have to commit. Making a hypothesis and getting correction on that is more effective than being unsure and just not committing fully. 
- To ground the model, we will use structured output and a thorough eval set

## Prompt

Cached system prompt and tagged blocks per request below .

```
<game>, <position>, <engine>, <player>, <stage>, <attempt>
```

## Notes

- Post-game is the perfect time to manually review a position rather than having an engine tell you immediately what's wrong with it, but you don't want to make it too hard. Don't make it too hard, or else the student doesn't want to learn, and it's inefficient Because it takes a lot of time, and oftentimes there's just a trick that you need to keep in mind, just Like solving problems on tests in school  . 

- Sometimes there will be things like, "Oh, why do you make this move? It seems a little risky." It's like, a human would feel like it's a little risky, but in general, all your pieces are well protected or protected just enough. Or in another scenario: why do you do this? It's because if my opponent doesn't play well, then in the next move I can threaten a fork. Not even an immediate fork, but I can threaten to do a fork either to attack or to defend my pieces through a fork, which is a little trickier to spot as well. Not just forks, but tactics in general. 

- Store analytics of the users' mistakes so we can group them, categorize them, and prioritize them. Having priorities is core to planning. 
- Based on the opponents' games, analyze what they played, common patterns, what they could have done better, and their themes, and repeated mistakes that they should learn from
- Opening is pretty standard, nothing too crazy. But they make a blunder in the opening. And then I blunder back and they're like, "Oh you can trap a piece." They can trap my bishop but it's unintuitive because the only good move for them after I move the bishop is a king move; doesn't feel like they're trapping my bishop. The best move for me is to let my bishop get taken.
- https://www.chess.com/analysis/game/live/186125417660/review?move=40


- And think about why moves are inaccuracies rather than there being a better move or this leaving some opening to be exploited.
Give the long-term idea because short-term is generally very easy for people to correct, and if it's just a mistake, there's not much to harp on about. But long-term ideas are much less obvious. But an LLM has access to the general ideas of pretty much every opening with minimal effort, so that's what we want to use. 

- The current flow is like, "Oh, this is an inaccurate move. You should have done this one instead." But then it just tells you that, but you don't really think about, "Oh, did that move? Okay, but how would I derive it myself? Why not this other move?" If you want to see that, then you have to run the engine line again. So I can give you an assortment of decent moves, not just the best move, and then the general idea behind them. Or, if the moves can be categorized into different ideas, then do that. For example, I push my h-pawns. I want to do a pawn storm, versus I just move my bishop somewhere. I'm just trying to improve my development. 

## Current chess.com game review limitations

- okay at telling you how moves work, like "you put your knight on an outpost" not just that you put your piece up somewhere nice.
- doesn't teach theory. We should learn ideas rather than memorizing so you can learn to think on your own.
- doesn't tell you much about the intention of the move, it only tells you what the move immediately does (like you're moving away from a threat) but it doesn't tell you why moving to one square is better or the other square is better to move away from a threat.

## Learning research (check features against this)

- Chunking (Chase & Simon 1973): skill = stored patterns. Tag each critical moment with a motif so mistakes group by pattern across games.
- Serious solo study beats more games (Charness et al. 2005): the core loop is deliberate review of the user's own games.
- Retrieval first (Roediger & Karpicke 2006): each blunder becomes a "find the better move" puzzle before any explanation. Engine line hidden until asked.
- Spacing (Cepeda et al. 2006): missed positions come back days later.
- Interleaving (Rohrer & Taylor 2007): don't reveal the motif before the attempt.
- Expertise reversal (Kalyuga 2003): explanation depth scales down as rating goes up.
- Feedback on the task, not the person (Kluger & DeNisi 1996): no grades-first, no "careless".
- Low cognitive load: max 3 points per game.

---

# TODO

## outline

- features clarification
- boilerplate
- v0 chess tutor using stockfish, chess.com api, and claude api
- create eval set (i can play some games or label some)

- ui improvements

## features

- user moves/style based on game history
- critical moments
- hint ladder
- spaced repetition
