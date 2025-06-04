# Detachr - Figma Variable Manager

A Figma plugin that allows you to scan and detach variables from your designs.

## Features

- Scan design elements for variable bindings
- Filter variables by type (color, text, number, spacing, boolean, other)
- Preview changes before applying them
- Detach variables while preserving their current values

## Development

This plugin is developed with TypeScript for improved type safety and development experience.

### Project Structure

- `code.ts` - Main plugin code (edit this file)
- `code.js` - Compiled JavaScript (auto-generated)
- `ui.html` - Plugin UI
- `manifest.json` - Plugin configuration
- `package.json` - npm configuration
- `tsconfig.json` - TypeScript configuration

### Development Workflow

1. Edit the TypeScript file (`code.ts`)
2. Compile TypeScript to JavaScript:
   ```
   npm run build
   ```
3. For continuous development with auto-compilation:
   ```
   npm run watch
   ```

## Installation

1. In Figma, navigate to Plugins > Development > Import plugin from manifest
2. Select the `manifest.json` file from this directory

## How It Works

1. The plugin scans for variable bindings in the selected elements or the current page
2. It identifies variable types (color, text, number, etc.)
3. Users can choose which types of variables to detach
4. When detaching, the plugin preserves the current values by setting them directly on the elements

## Tips

- Use "Preview Mode" to see what would be detached before applying changes
- Only detach variables that you specifically need to break from the design system
- The plugin works on the current selection or the whole page if nothing is selected
