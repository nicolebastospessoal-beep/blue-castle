# Blue Castle 🏰

Jogo de plataforma 2D feito com **HTML5 Canvas e JavaScript puro** — sem dependências, sem build.

Guie o cavaleiro pelas muralhas, salões e pela torre do Castelo Azul, colete todos os
cristais para abrir o portão de cada fase e chegue à saída.

## Como jogar

Abra `index.html` no navegador (basta dar dois cliques no arquivo), ou sirva a pasta:

```bash
python3 -m http.server 8000
# depois acesse http://localhost:8000
```

### Controles

| Ação | Teclado | Toque |
| --- | --- | --- |
| Mover | ← → ou A D | ◀ ▶ |
| Pular (segure para pular mais alto) | ↑, W, Espaço ou Z | ▲ |
| Descer de plataforma de madeira | ↓ ou S | ▼ |
| Pausar | P ou Esc | ❚❚ |
| Reiniciar a fase | R | — |
| Som liga/desliga | M | — |
| Confirmar nos menus | Enter ou Espaço | tocar na tela |

### Regras

- Colete **todos os cristais** 💎 para abrir o portão da fase.
- Pule **em cima** dos slimes e morcegos para derrotá-los (+50 pontos).
- Encostar em inimigos ou espinhos tira um coração; cair em um buraco também.
- Bandeiras são **checkpoints**: ao cair, você volta para a última bandeira ativada.
- Corações ❤️ recuperam vida (máximo 5).
- Bônus ao terminar a fase: tempo restante abaixo da meta e +500 por terminar sem dano.
- O recorde fica salvo no navegador.

## Estrutura

```
index.html       página e controles de toque
css/style.css    layout responsivo (16:9)
js/levels.js     mapas das fases em texto (legenda no topo do arquivo)
js/game.js       motor: física, colisão, inimigos, render, HUD, áudio
```

### Criando fases

Cada fase em `js/levels.js` é uma lista de linhas de texto, onde cada caractere é um bloco
de 32×32 px (`#` pedra, `=` plataforma, `^` espinhos, `o` cristal, `S` slime, `B` morcego,
`C` checkpoint, `h` coração, `T` tocha, `P` início, `D` portão). Basta adicionar um novo
objeto ao array `LEVELS` — o jogo detecta o número de fases automaticamente.

Referência de alcance do pulo: até 3 blocos de altura e cerca de 4 blocos de distância.
