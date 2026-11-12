FUTURE
Store moves and cached stuff in local storage for now. Later on, it would be in a proper backend, like a cloud service (AWS) or self-hosted Postgres. Because it's good for structured data and modern 

---

FUTURE
I want things like, "Would this attack have worked?" 
Even if the best move is to abort the attack and defend, you could try removing pieces or assuming you had a few tempi Such that you can actually try to carry out the attack The moment you initialize the attack, you would be told that the attack doesn't work because of such and such. But then, if you wanted to carry out the attack, you could take away those reasons for why the attack wouldn't work and then continue guiding from there. 

---

Use a combination of threat arrows to illustrate the opponent's threat, as well as just highlight areas on the board that are high interest. It doesn't just have to be the exact squares that pieces are on, just the general quarter or portion of the board, or circle part of the board or something, to draw the students' attention. 

It's really easy to give hints that give away too much, so I think highlighting an area of the board is one step towards not giving away too much, as well as Using arrows of your opponent's ideas so you can counter them, and then only naming pieces, tactics, and moves as a last resort. I think there could still be an intermediary step. 

Keep prompt responses short and let the visualization do the talking, because images are worth a thousand words. 

Imagine a stripped-away version of the board that only has the relevant parts, so you're not distracted by other portions of the board, like tunnel vision. 

Currently in design, we're prioritizing ideas over best moves. This involves higher multi-PV. The idea is progress over perfection. Perfection, in this case, is too narrow of a window to learn from. 

----

FUTURE
Do more tuning and testing of the tutor; instructions & prompts, tools, UI. Gather usage data and adjust based on that.

Do A/B testing Of different prompts and record the metrics of things like:
- how long the player spends guessing (time spent)
- num hints
- their success rate
- their seeming frustration, by statistical analysis or training another model to look at other micro-interactions
- how many moves they go through
- etc.

----

leaning into the hint ladder, spaced repetition, and visualization and ideas

---

Spaced repetition

- Context is a hint. You get a stream of moves, and you have to determine where there was a critical position, if there was an inaccuracy, and how to improve on that. 
- Ask similar positions (from your game history) a few days later, so it can't be memorized. 
- Ask for the idea so it's more LLM-based, and you have to explain your reasoning. How do we mark this? Whether it's the right idea in the right zone, if you understand your opponent's motif. Grade it as incorrect, missing some details, and completely correct. It's like a verbal reasoning test, which, by nature, is less deterministic, but I guess this is a way to show off model engineering. 
- Slightly modified positions 