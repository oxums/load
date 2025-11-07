# Load Editor

Lightweight text editor for quick file editing tasks.

### Design inspiration

Zed.dev, my current favorite text editor.

## File load system

- Send state to UI
- Rust gets file and parses/tokenizes it
- Send needed tokens to UI
- UI displays tokens and allows editing
- Buffer edits are sent back to Rust for processing
- New tokens to UI
- Autosave happens based on settings
