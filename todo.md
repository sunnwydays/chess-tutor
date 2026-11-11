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

I want things like, "Would this attack have worked?" 
Even if the best move is to abort the attack and defend, you could try removing pieces or assuming you had a few tempi Such that you can actually try to carry out the attack The moment you initialize the attack, you would be told that the attack doesn't work because of such and such. But then, if you wanted to carry out the attack, you could take away those reasons for why the attack wouldn't work and then continue guiding from there. 