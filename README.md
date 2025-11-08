# Load Editor

Lightweight text editor for quick file editing tasks.

### Design inspiration

Zed.dev, my current favorite text editor.

## Made for an hackaton

This project was made for the Build-a-thon hackaton and some things aren't polished.
Copilot AI was used in the development mainly for boilerplate code / boring tasks.

## File load system

- Send state to UI
- Rust gets file and parses/tokenizes it
- Send needed tokens to UI
- UI displays tokens and allows editing
- Buffer edits are sent back to Rust for processing
- New tokens to UI
- Autosave happens based on settings
