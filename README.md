# Blue Castle 🏰

RPG 2D em pixel art, visto de cima, feito com **HTML5 Canvas e JavaScript puro**: sem dependências e sem build.

Você controla o Rei Azul em uma vila com praça, feira, catedral, rio, fazenda e lago. Dá para explorar, nadar, cortar mato com a espada, sentar nos bancos, beber poções, tocar o sino e encontrar os 4 baús escondidos.

- **Relógio:** o dia dura 12 minutos reais e a noite, outros 12. O relógio no canto superior direito avança com o tempo, e há crepúsculo e amanhecer graduais. À noite os prédios mudam de sprite e as luzes se acendem. Dormir em casa pula para o próximo período.
- **Vida:** a barra de corações fica no canto inferior esquerdo e sobe e desce em meios corações. A fogueira tira ½ coração, a poção cura 2 corações e a água do poço cura 1.
- **Morte:** com a vida zerada, o rei desmaia e aparece a tela "Você morreu... Renasça.". Ao confirmar, ele renasce em casa.
- **Pausa:** o botão no canto superior esquerdo funciona com clique ou toque (ou P / Esc).

## Como jogar

Abra o `index.html` no navegador (dois cliques bastam) ou sirva a pasta:

```bash
python3 -m http.server 8000   # depois acesse http://localhost:8000
```

| Ação | Teclado | Toque |
| --- | --- | --- |
| Andar | WASD / setas | direcional |
| Correr | Shift (segurar) | R |
| Atacar / cortar mato | Espaço ou J | B |
| Interagir (abrir, ler, sentar, dormir) | E ou Enter | A |
| Beber poção | Q | ♥ |
| Sentar no chão | C | — |
| Pausar / Som | P ou Esc / M | ❚❚ |

## Estrutura

```
index.html                 página e controles de toque
css/style.css              layout responsivo 16:9
js/world.js                mapa da vila: chão, prédios, árvores, baús e falas
js/game.js                 motor: movimento, colisão, animações, dia/noite, HUD, áudio
assets/originais/          folhas de sprites originais (fonte)
assets/game/               atlas e tiles gerados (usados pelo jogo)
tools/build_assets.py      recorta as folhas e gera assets/game/
tools/spritelib.py         remoção de fundo magenta, grades e marca d'água
```

## Regenerando os assets

As folhas em `assets/originais/` estão em alta resolução, com fundo magenta. O script recorta cada sprite, remove o fundo, as linhas de grade e a marca d'água, reduz para a escala do jogo (tiles de 64×64, personagem com cerca de 76 px de altura) e gera:

- `assets/game/atlas.webp` + `atlas.js`: todos os sprites, com nome → posição;
- `assets/game/tiles.webp` + `tiles.js`: tiles de chão 64×64.

```bash
pip install pillow numpy
python3 tools/build_assets.py
```

Para dar nome a um recorte novo ou corrigir a escala de uma folha, edite `NAMES`, `SHEETS` e `TARGET_H` em `tools/build_assets.py`. Recortes sem nome ficam disponíveis como `<folha>-<n>` (por exemplo, `mercado-61` é a fogueira).

Os sprites são posicionados pela **base** (o ponto do pé) e desenhados na ordem da coordenada `y`. Assim o personagem passa naturalmente na frente ou atrás das árvores e casas.
