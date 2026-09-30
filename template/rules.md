# Rules para réplica de estructura y diseño de PPT — Template_Mint

## Rol y Objetivo

Actúa como un diseñador de presentaciones experto. Tu tarea es generar el contenido y la disposición (layout) de las nuevas diapositivas asegurando que sigan estrictamente la estructura espacial y visual de `Template_Mint.pptx`, la plantilla de referencia de este proyecto (presentación del proyecto **MINT — MRI Instruction and Navigation for Technologists**, PUC Chile / CAMERA Africa / McGill).

**Antes de diseñar cualquier diapositiva nueva:** relee la sección 0 (sistema de diseño observado). No inventes colores, tipografías ni proporciones — usa exactamente las que se documentan aquí, extraídas directamente del archivo `.pptx`.

---

## 0. Sistema de diseño observado (ground truth, extraído del .pptx)

Este `.pptx` **no tiene placeholders de título/cuerpo poblados** en sus diapositivas de ejemplo — es una plantilla ligera construida a base de formas decorativas (`Freeform`) e imágenes colocadas directamente sobre el lienzo, no del sistema de layouts maestros de PowerPoint (los 11 `slideLayout` incluidos son los layouts genéricos de Office sin modificar). El diseño real vive en las 4 diapositivas de muestra. Todo lo de abajo es observación directa de esas 4 diapositivas.

**Tamaño de lienzo:** 13.33" × 7.5" (16:9) — 12192000 × 6858000 EMU.

**Paleta de colores (usar siempre estos hex, no aproximar):**

| Rol | Hex | Uso observado |
|---|---|---|
| Azul marino (dominante) | `#01224E` | Fondo de la barra/banda superior en diapositivas de contenido; segmento largo de la barra en diapositivas de transición |
| Verde menta / Teal (acento) | `#04989F` | Segmento corto de acento en diapositivas de transición; color de marca (aparece en el logo MINT) |
| Blanco | `#FFFFFF` | Texto sobre fondo oscuro (banda navy) |
| Negro casi puro | `#1A1A1A` | Texto de cuerpo/pie sobre fondo claro |

El tema de PowerPoint (`theme1.xml`) trae la paleta y fuentes por defecto de Office (Aptos, azul `156082`, etc.) pero **no se usa en ninguna diapositiva real** — todas las formas y textos fijan su color/fuente explícitamente. No uses los colores del tema por defecto; usa solo los cuatro de la tabla.

**Tipografías (usar siempre estas dos, nunca la fuente por defecto del tema):**

| Fuente | Rol observado |
|---|---|
| **TT Rounds Condensed** | Titulares / texto de marca (condensada, geométrica-redondeada) |
| **TT Drugs** | Cuerpo, etiquetas, créditos (texto de autores en portada: 17.77pt) |

**Elementos de marca (logos institucionales) — reutilizados tal cual, sin recolorear ni recortar:**
- Logo **MINT** (isotipo MRI + hoja de menta, navy + teal) — funciona como el título gráfico de la portada.
- Logo **Pontificia Universidad Católica de Chile** (sello circular + texto, negro).
- Logo **CAMERA — Democratizing MRI** (mapa de África, azul/gris).
- Escudo **McGill University** (rojo).
- Imagen institucional "Biomedical Imaging Center — PUC" (ilustración de línea del edificio, banner en diapositiva 4).

---

## 1. Arquitectura de las Diapositivas (Layout)

- **Estructura del título:** no hay un cuadro de texto de título tradicional en las diapositivas de contenido de muestra; en su lugar hay una **banda sólida navy (`#01224E`) de esquinas redondeadas** que ocupa todo el ancho del slide y ~1.23" de alto, pegada al borde superior (offset 0,0). El título de cada diapositiva de contenido nueva debe escribirse **dentro de esa banda**, en blanco, alineado a la izquierda con un margen de ~0.5", usando TT Rounds Condensed. No agregues líneas divisorias adicionales bajo el título — la banda de color ya cumple esa función.
- **Retícula y columnas:** la plantilla de muestra no incluye un ejemplo de contenido a dos columnas (las 4 diapositivas son en su mayoría estructurales/con imagen a sangre). Cuando una diapositiva nueva necesite dos columnas, usa **60/40** (texto 60% izquierda, imagen/gráfico 40% derecha) como proporción por defecto, dejando siempre la banda navy superior como cabecera común. No inventes una proporción distinta por diapositiva — mantenla consistente en todas las diapositivas de contenido estándar.
- **Densidad de información:** el "aire" en esta plantilla es muy generoso — las diapositivas de muestra casi no tienen texto. Limita el cuerpo de cada diapositiva nueva a **máximo 3-4 ideas cortas** (subtítulo en negrita + 1-2 líneas), nunca párrafos largos ni más de un bloque de texto denso por slide.

## 2. Consistencia de Elementos Visuales

- **Estilo de "viñetas":** no se observan viñetas tradicionales (•) en ninguna diapositiva de muestra. Sigue el espíritu limpio de la marca: usa **subtítulos cortos en negrita (TT Rounds Condensed) seguidos de una línea de texto en TT Drugs**, en vez de listas con puntos. Si se necesita numerar pasos, usa números grandes en navy o teal, no viñetas genéricas.
- **Contenedores y tarjetas:** el único contenedor observado es la **banda de esquinas redondeadas** (el mismo `Freeform` reutilizado a distintas escalas: banda completa de cabecera en slides de contenido, y barra delgada bicolor — teal corto + navy largo — centrada verticalmente en la diapositiva de transición). Si una diapositiva nueva necesita agrupar conceptos, usa ese mismo lenguaje de "barra/franja de esquinas redondeadas" en navy o teal como contenedor, no rectángulos genéricos ni cajas con sombra.
- **Tratamiento de imágenes:**
  - **Portada:** imagen de fondo a sangre completa (foto del equipo MRI) al 21% de opacidad detrás de todo, más una imagen principal (el logo/isotipo MINT) ocupando ~87% del ancho y ~73% del alto, centrada en la mitad superior del slide.
  - **Diapositivas de foto/institucionales:** imagen a sangre casi completa (edge-to-edge, solo ~0.3" de margen izquierdo, 0 a la derecha) debajo de la banda navy superior.
  - **Logos institucionales:** siempre como insignias pequeñas en esquinas fijas — arriba a la derecha sobre la imagen principal en la portada; abajo a la izquierda superpuestos sobre la foto en diapositivas de contenido/institucionales. Reutiliza los mismos tamaños (~2.4"×1.4" y ~1.4"×1.5") para mantener consistencia entre diapositivas.

## 3. Ritmo y Tipos de Diapositivas

Patrones identificados en las 4 diapositivas de muestra — replica estos 4 tipos según el flujo de la presentación:

1. **Portada (slide 1):** fondo con foto a sangre a baja opacidad (21%) + logo MINT grande centrado en la mitad superior (hace de "título") + logos institucionales (PUC, CAMERA) arriba a la derecha + nombres/emails de autores centrados en la franja inferior, en TT Drugs 17.77pt negro sobre blanco.
2. **Contenido estándar (slide 2):** banda navy de esquinas redondeadas ocupando todo el ancho superior (~1.23" de alto) para el título en blanco; el resto del slide queda en blanco/claro para el cuerpo (2-4 ideas cortas, sin subtítulos intermedios).
3. **Transición/Sección (slide 3):** sin banda superior; en su lugar, una **barra horizontal delgada centrada verticalmente** (a ~53% de la altura del slide), compuesta de un segmento corto teal (`#04989F`) a la izquierda y uno largo navy (`#01224E`) a la derecha. El título de sección va sobre/junto a esta barra, grande y centrado, sin subtítulos.
4. **Imagen/Institucional (slide 4):** misma banda navy superior que el tipo "Contenido estándar" + imagen a sangre casi completa debajo (foto o banner institucional) + logos de marca superpuestos en la esquina inferior izquierda.
5. **Cierre/Conclusión:** no hay una diapositiva de muestra de este tipo en el archivo. Por consistencia con el resto de la plantilla, extrapola el lenguaje de la portada (fondo navy o foto a baja opacidad + una frase corta y grande centrada en TT Rounds Condensed, blanco) en vez de inventar un estilo nuevo.

## 4. Restricciones Estrictas (Lo que NO debes hacer)

- **No rompas la jerarquía:** no agregues subtítulos intermedios en las diapositivas de contenido estándar — la plantilla pasa directo de la banda de título a los bloques de contenido.
- **No satures:** si una idea no cabe en 3-4 puntos cortos dentro del área bajo la banda navy, divide en dos diapositivas consecutivas en vez de comprimir el texto o reducir el tamaño de fuente.
- **No uses colores fuera de la paleta de 4 colores** (`#01224E`, `#04989F`, `#FFFFFF`, `#1A1A1A`). No uses los colores por defecto del tema de Office (azul `156082`, naranja `E97132`, etc. — están definidos en el tema pero no se usan en ninguna diapositiva real).
- **No uses fuentes fuera de TT Rounds Condensed (titulares) y TT Drugs (cuerpo).** No uses Aptos ni Aptos Display aunque aparezcan como fuente del tema.
- **No agregues líneas divisorias bajo los títulos** — el contenedor de color (banda navy o barra bicolor) ya cumple esa función visual.
- **No modifiques ni recolorees los logos institucionales** (MINT, PUC, CAMERA, McGill) — se insertan tal cual, con los tamaños y posiciones de esquina documentados en la sección 2.
- **No inventes un layout de columnas distinto por diapositiva** — usa 60/40 de forma consistente en todo el contenido estándar.

---

## Anexo — Referencia técnica rápida (para quien edite el .pptx directamente)

- **Diapositivas de ejemplo:** `slide1.xml` (portada), `slide2.xml` (patrón de banda de cabecera), `slide3.xml` (patrón de barra de transición), `slide4.xml` (patrón banda + imagen institucional). Los 11 `slideLayout*.xml` son genéricos de Office y no reflejan el diseño real — no los uses como referencia visual.
- **Geometría de la banda de cabecera:** grupo con dos `Freeform` (relleno navy + contorno de esquinas redondeadas), posición `(0,0)`, tamaño `13.33" × 1.23"`.
- **Geometría de la barra de transición:** segmento teal `(1.27", 3.98")` tamaño `2.31" × 0.26"` + segmento navy `(3.58", 3.98")` tamaño `8.85" × 0.26"` (mismo grupo/forma de la banda de cabecera, reescalado).
- **Imágenes de marca:** `image3.png` (logo MINT), `image4.png` (logo PUC), `image5.png` (logo CAMERA), `image7.png` (escudo McGill), `image6.jpg` (banner "Biomedical Imaging Center"), `image1.png` (foto de fondo, portada, a 21% opacidad).
