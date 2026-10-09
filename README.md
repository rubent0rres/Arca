<p align="center">
  <img src="public/arca-icon.png" alt="Icono de Arca: un cofre violeta con documentos" width="128" />
</p>

# Arca

**Tus archivos, en un solo lugar.**

Arca es un gestor de archivos comprimidos para macOS. Permite explorar, crear y extraer archivos RAR, 7z y ZIP con una interfaz oscura, arrastrar y soltar, soporte para contraseñas y progreso de extracción.

Desarrollado por **Rubén J. Torres** · [dev@rubentorres.com.mx](mailto:dev@rubentorres.com.mx)

## Funciones

- **Explorar:** consulta archivos y carpetas antes de extraerlos y navega con doble clic y rutas de navegación.
- **Abrir desde Finder:** haz clic en el área «Arrastra aquí» para seleccionar un archivo, o suéltalo directamente en la app.
- **Extraer:** descomprime el contenido en una carpeta junto al archivo original y abre el resultado en Finder.
- **Crear:** comprime uno o varios archivos en formato RAR, 7z o ZIP.
- **Buscar:** encuentra entradas por su nombre o ruta dentro del archivo comprimido.
- **Comprobar:** verifica la integridad del archivo.
- **Contraseñas:** detecta archivos protegidos y solicita la contraseña cuando es necesaria. Se conserva solo en memoria mientras ese archivo está abierto y se reutiliza al extraer o comprobar.
- **Información:** consulta formato, tamaño, cantidad de archivos y ubicación en un modal.
- **Barra de estado:** muestra progreso, resultados y resumen del archivo sin desplazar la ventana principal.
- **Acerca de Arca:** muestra la versión, el desarrollador y su correo de contacto, incluso sin un archivo abierto.

## Formatos compatibles

| Formato | Explorar | Extraer | Comprobar | Crear | Herramienta |
| --- | --- | --- | --- | --- | --- |
| RAR | Sí | Sí | Sí | Sí | UnRAR para leer y extraer; RAR para crear |
| 7z | Sí | Sí | Sí | Sí | 7-Zip incluido |
| ZIP | Sí | Sí | Sí | Sí | 7-Zip incluido |

La creación admite archivos individuales, incluidos varios a la vez. Por ahora no admite arrastrar carpetas ni crear archivos protegidos con contraseña.

## Requisitos

### Para usar la app

- macOS. El paquete actual se genera para Apple Silicon (`arm64`).
- Permiso de escritura en la carpeta de destino para crear o extraer archivos.
- **RAR y UnRAR** instalados para las operaciones con archivos RAR. Las operaciones 7z y ZIP utilizan el ejecutable incluido en la aplicación.

### Herramientas RAR

Descarga el paquete RAR para macOS correspondiente a tu procesador desde [las descargas oficiales](https://winrar.es/descargas).

Arca busca los ejecutables `rar` y `unrar` en estas ubicaciones, en este orden:

1. `/Applications/rar/`
2. `/opt/homebrew/bin/`
3. `/usr/local/bin/`

Para la primera opción, coloca los ejecutables del paquete descargado en `/Applications/rar/rar` y `/Applications/rar/unrar`, con permiso de ejecución. Estos binarios externos no se incluyen en el repositorio ni en el paquete de Arca.

### Para desarrollar

- Node.js 22.12 o posterior y npm.
- Las herramientas RAR anteriores, si quieres trabajar con ese formato.
- 7-Zip se incluye en `vendor/7zip/7zz` como binario universal de macOS para `arm64` y `x86_64`.

## Desarrollo

Clona el repositorio o descarga su código fuente y abre una terminal dentro de la carpeta **Arca**.

Instala las dependencias:

```sh
npm ci
```

Inicia la interfaz:

```sh
npm run dev
```

En otra terminal, dentro de la misma carpeta, abre la aplicación:

```sh
npm start
```

Vite sirve la interfaz en `http://127.0.0.1:5173`. Mantén ambas terminales abiertas durante el desarrollo.

## Compilar e instalar en macOS

Genera la aplicación:

```sh
npm run package:mac
```

En Apple Silicon, el resultado queda en:

```text
release/mac-arm64/Arca.app
```

Cierra cualquier versión abierta de Arca y copia la aplicación generada a **Aplicaciones**. Ábrela desde Finder o el Dock.

Este proceso genera un paquete `.app` local. No crea un instalador DMG ni configura firma de distribución o notarización.

## Uso

### Abrir y explorar

1. Selecciona **Abrir**.
2. Arrastra un archivo `.rar`, `.7z` o `.zip` a la ventana. También puedes hacer clic en el área «Arrastra aquí» para buscarlo en Finder.
3. Si está protegido, introduce su contraseña.
4. Haz doble clic en una carpeta para entrar. Usa la flecha o la ruta superior para regresar.
5. Utiliza **Buscar** para filtrar el contenido o **Info** para ver sus detalles.

### Extraer y comprobar

Con un archivo abierto, selecciona **Extraer** o **Comprobar**. El porcentaje y los resultados aparecen en la barra inferior.

La extracción crea una carpeta junto al archivo comprimido y conserva su estructura interna. Si el nombre de destino ya existe, se añade un número para crear una carpeta nueva. Al terminar, **Abrir carpeta** muestra el resultado en Finder.

### Crear un archivo comprimido

1. Selecciona **Crear**.
2. Elige **RAR**, **7z** o **ZIP**.
3. Arrastra uno o varios archivos.
4. El resultado se guarda junto al primer archivo seleccionado, con un nombre disponible.

### Consultar el desarrollador

Selecciona **Acerca de** en la barra de herramientas. El correo de contacto abre tu aplicación de correo al hacer clic; Arca no envía mensajes automáticamente.

## Comandos disponibles

| Comando | Función |
| --- | --- |
| `npm run dev` | Inicia Vite para desarrollar la interfaz |
| `npm start` | Abre Electron conectado a Vite |
| `npm run build` | Compila la interfaz en `dist/` |
| `npm run package:mac` | Compila y empaqueta la aplicación para macOS |
| `npm test` | Ejecuta las pruebas de regresión existentes |

Las pruebas de regresión necesitan `/Applications/rar/rar` y el ejecutable incluido `vendor/7zip/7zz`. Generan archivos temporales para cubrir contraseñas, navegación y extracción en los formatos compatibles.

## Estructura del proyecto

```text
Arca/
├── electron/
│   ├── main.cjs                 # Ventana, operaciones de archivos y procesos externos
│   └── preload.cjs              # Comunicación entre Electron y la interfaz
├── src/
│   ├── main.jsx                 # Interfaz React
│   └── styles.css               # Estilos y tema oscuro
├── public/
│   └── arca-icon.png            # Icono de la interfaz
├── build/
│   └── arca.icns                # Icono de macOS
├── vendor/7zip/                 # Ejecutable y licencia de 7-Zip
├── tests/                      # Pruebas de regresión
├── docs/                       # Documentación del diseño
└── package.json                # Dependencias y configuración de empaquetado
```

Tecnologías principales: **Electron**, **React**, **Vite**, **Lucide React**, **RAR/UnRAR** y **7-Zip**.

## Componentes y créditos

- El ejecutable de 7-Zip se distribuye con su [licencia incluida](vendor/7zip/License.txt). El paquete de Arca también incorpora este archivo en sus recursos.
- RAR y UnRAR se instalan por separado y conservan sus propias condiciones de uso.
- El icono representa un cofre que guarda documentos. Su [descripción de diseño](docs/arca-icon-design.md) se conserva en el repositorio.

## Contribuciones

Si encuentras un problema, incluye el formato del archivo, la versión de macOS, los pasos para reproducirlo y el mensaje mostrado por Arca.

Las propuestas de mejora y contribuciones al código son bienvenidas.

## Desarrollador

**Rubén J. Torres**  
[dev@rubentorres.com.mx](mailto:dev@rubentorres.com.mx)
