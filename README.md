# VFR Chile · Planificador de vuelo

App web progresiva (PWA) para planificar vuelos VFR en Chile, orientada a pilotos civiles. Funciona en el navegador del teléfono, se puede instalar y sigue funcionando sin conexión (salvo la meteorología).

## Funciones

- **Mapa** con los 452 aeródromos y helipuertos del AIP Chile, coloreados por tipo (público, privado, militar, helipuerto). Capas OpenStreetMap, topográfica y satélite. METAR del área visible con categoría de vuelo (VFR / MVFR / IFR / LIFR). Mantén presionado el mapa para crear puntos de ruta propios.
- **Plan de vuelo**: origen, puntos intermedios, destino y alternativa. Navlog por tramo con rumbo verdadero, corrección por viento, rumbo magnético, velocidad sobre tierra, tiempos, ETA y combustible. Viento pronosticado en altura (Open-Meteo) según la altitud de crucero. Avisos de combustible, ocaso, aeródromos privados o cerrados. Guardar planes, invertir ruta, compartir briefing y exportar GPX.
- **Meteorología**: METAR y TAF decodificados (aviationweather.gov), pronóstico horario por aeródromo, orto, ocaso y fin del crepúsculo civil. Enlaces a METAR, NOTAM y cámaras de la DGAC.
- **Vuelo**: GPS del teléfono con velocidad sobre tierra, altitud, track, velocidad vertical, distancia, rumbo y ETE al próximo punto, desviación lateral (XTK), distancia y ETA al destino, combustible restante y autonomía estimados, indicador de rumbo, secuencia automática de puntos, "Directo a", aeródromos más cercanos, registro de la traza en GPX y pantalla siempre encendida. Incluye un modo simulación a 10× para practicar en tierra.
- **Aeródromos**: buscador con filtros por tipo, uso y región, orden por cercanía y ficha completa (frecuencias, elevación, horario, administrador, observaciones y enlace al PDF del AIP).

## Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub y sube **el contenido de esta carpeta** (que `index.html` quede en la raíz del repositorio).
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.
3. Espera uno o dos minutos y abre `https://TU_USUARIO.github.io/TU_REPOSITORIO/`.

La app necesita HTTPS para el GPS, la instalación y el modo sin conexión; GitHub Pages ya lo entrega.

## Generar la app con PWABuilder

1. Entra a https://www.pwabuilder.com e ingresa la URL de GitHub Pages.
2. Revisa el informe (manifiesto, service worker e íconos ya están incluidos).
3. Elige **Android** (Google Play / APK) o **iOS** y descarga el paquete.

## Estructura

```
index.html              Interfaz
css/styles.css          Estilos
js/app.js               Lógica (navegación, meteo, mapa, GPS)
data/aerodromos.js      Base de aeródromos (AIP Chile, 06-11-2026)
sw.js                   Service worker (sin conexión y caché de mapas)
manifest.webmanifest    Manifiesto PWA
icons/, screenshots/    Íconos y capturas para la tienda
```

## Actualizar los aeródromos

Los datos provienen del servicio del Mapa Interactivo del IFIS (`https://aipchile.dgac.gob.cl/api/aerodrome`). Para actualizarlos, regenera `data/aerodromos.js` con el mismo formato y sube el cambio. Cambia también `VERSION` en `sw.js` para que los teléfonos descarguen la versión nueva.

## Fuentes de datos

- Aeródromos: IFIS / AIP Chile, Dirección General de Aeronáutica Civil.
- METAR / TAF: Aviation Weather Center (NOAA), aviationweather.gov.
- Pronóstico y viento en altura: Open-Meteo.
- Mapas: OpenStreetMap, OpenTopoMap, Esri.

## Aviso

Herramienta de apoyo. No es una fuente oficial ni reemplaza el AIP vigente, los NOTAM, el briefing meteorológico de la DGAC, las cartas aeronáuticas ni los instrumentos de la aeronave. La altitud y la velocidad del GPS del teléfono son referenciales. El piloto al mando es responsable de verificar toda la información.
