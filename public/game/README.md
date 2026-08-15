# Conecta 8

Juego web de palabras desarrollado con HTML5, CSS3 y JavaScript Vanilla. No usa frameworks, paquetes ni servicios externos.

## Ejecutar

1. Conserva todos los archivos dentro de la carpeta `conecta-8`.
2. Abre `index.html` directamente en un navegador moderno.
3. Escribe ocho palabras y pulsa **Comenzar**.

No se necesita servidor local, instalación ni conexión a Internet.

## Reglas

- La partida comienza con 60 segundos.
- Una respuesta correcta suma 10 segundos.
- Cada pista resta 3 segundos y revela la siguiente letra; hay un máximo de tres pistas por palabra.
- Cada palabra permite tres intentos. Al tercer error, los intentos vuelven a cero y se restan 5 segundos.
- Solo la palabra activa acepta respuestas. Al resolverla se activa la siguiente.

## Estructura

- `index.html`: estructura y carga de recursos.
- `styles.css`: diseño responsive, estados y animaciones.
- `app.js`: coordinación general y eventos.
- `game.js`: reglas y estado de la partida.
- `timer.js`: temporizador reutilizable.
- `hints.js`: generación de palabras ocultas y pistas.
- `ui.js`: construcción dinámica y actualización de la interfaz.
- `assets/`: reservado para recursos locales futuros.

## Compatibilidad

La aplicación está optimizada para teléfonos y se adapta a escritorio. Incluye controles de teclado, estados de foco y compatibilidad con la preferencia de movimiento reducido del sistema.
