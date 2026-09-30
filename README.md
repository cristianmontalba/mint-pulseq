# MINT · MRI Sequence Design with Pulseq

<p align="center">
  <a href="https://cristianmontalba.github.io/mint-pulseq/">
    <img src="https://img.shields.io/badge/▶%20Abrir%20la%20página%20web-MINT%20Pulseq-2ea44f?style=for-the-badge" alt="Abrir la página web de MINT">
  </a>
</p>

<p align="center">
  <b>👉 <a href="https://cristianmontalba.github.io/mint-pulseq/">https://cristianmontalba.github.io/mint-pulseq/</a></b>
</p>

---

## ¿Qué es MINT?

**MINT** es una plataforma web interactiva para aprender y diseñar **secuencias de pulsos de Resonancia Magnética (RM)** usando **[Pulseq](https://pulseq.github.io/)**, el formato abierto e independiente del fabricante para programar secuencias.

La página permite explorar, visualizar y construir secuencias de RM, y obtener el código Pulseq correspondiente listo para usar en Python ([PyPulseq](https://github.com/imr-framework/pypulseq)) o MATLAB.

## Funcionalidades

- **Catálogo de secuencias**: navegación por secuencias clásicas con su física y parámetros explicados.
- **Diagramas de secuencia**: visualización de pulsos de RF, gradientes (Gx, Gy, Gz) y adquisición (ADC).
- **Animaciones y simulador**: representación interactiva del comportamiento de la magnetización y del espacio-k.
- **Constructor de secuencias (builder)**: combina bloques de excitación y trayectorias para componer una secuencia y generar su código Pulseq.
- **Fórmulas renderizadas** con KaTeX.

## Secuencias incluidas

| Secuencia | Python (PyPulseq) | MATLAB (Pulseq) |
|---|---|---|
| Spin Echo (SE) | `python/spin_echo.py` | `matlab/seq_SE.m.txt` |
| Gradient Echo (GRE) | `python/gradient_echo.py` | `matlab/seq_GE.m.txt` |
| Echo Planar Imaging (EPI) | `python/epi.py` | `matlab/epi.m.txt` |
| Spiral | `python/spiral.py` | `matlab/spiral.m.txt` |
| Radial | `python/radial.py` | — |
| Inversion Recovery (IR) | `python/inversion_recovery.py` | — |
| 2D T1 MPRAGE | `python/write_2Dt1_mprage.py` | — |
| Diametral / par | — | `matlab/diametral_par.m.txt` |

## Estructura del proyecto

```
mint-pulseq/
├── index.html              # Página principal
├── css/                    # Estilos
├── js/
│   ├── app.js              # Navegación y lógica principal
│   ├── builder.js          # Constructor de secuencias
│   ├── simulator.js        # Simulador
│   ├── diagrams.js         # Diagramas de secuencia
│   ├── animations.js       # Animaciones
│   └── data/
│       ├── sequences.js    # Definición de las secuencias
│       ├── videos.js       # Material audiovisual
│       └── templates/      # Plantillas de código Pulseq (excitaciones, trayectorias, composer)
├── python/                 # Scripts PyPulseq
└── matlab/                 # Scripts Pulseq para MATLAB
```

## Ejecutar localmente

No requiere instalación. Clona el repositorio y abre `index.html` en el navegador, o levanta un servidor local:

```bash
git clone https://github.com/cristianmontalba/mint-pulseq.git
cd mint-pulseq
python -m http.server 8080
```

Luego abre <http://localhost:8080>.

Para ejecutar los scripts de Python:

```bash
pip install pypulseq
python python/spin_echo.py
```

## Autor

**Cristian Montalba** · [github.com/cristianmontalba](https://github.com/cristianmontalba)
