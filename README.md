# QuoteKit

This project aims to provide a low-level API for creating and playing back [playable quotes](https://tenmile.quote.games/) that spans several emulated game platforms.

# Platforms

Here's a list of emulators that we aspire to support very soon:
- [RetroArch](https://github.com/libretro/RetroArch)
    - Game Boy, via the [gambatte](https://github.com/libretro/gambatte-libretro) libretro core
    - Super Nintendo Entertainment System, via the [snes9x](https://github.com/snes9xgit/snes9x) libretro core
    - Nintendo 64, via the [mupen64plus-libretro-nx](https://github.com/libretro/mupen64plus-libretro-nx) libretro core
- [v86](https://github.com/copy/v86), a PC emulator an x86-to-wasm JIT running in the browser
- [QEMU](https://github.com/qemu/qemu), a high-performance emulator/virtualizer often used to emulate desktop PC platforms on desktop PCs
- [MAME](https://github.com/mamedev/mame), a multi-emulator emphasizing arcade games

# API Design

## Plumbing API

A JavaScript file called `{emulator}-plumbing.js` should, upon execution, provide a `QuoteKit` object in the global namespace that offers the methods and events below.

### Methods:
- `getDeviceInfo()`: Returns an `object` containing name, block size, and block count for devices. The keys of this object will tell you the names of the devices mentioned elsewhere in the API.
    - TODO: more precisely document the structure of the returned object and maybe change the type from `object` to `Map`
- `saveResidue()`: Returns an `ArrayBuffer`. Ideally this contains only information that isn't stored in block devices. However, sloppy implementations may return gigantic residues.
- `restoreResidue(buffer)`: Restores a previously saved residue (assuming the machine's device configuration has not changed, that the residue is compatible with the current machine).
- `readBlock(device,index)`: Returns an `ArrayBuffer` of size expected from the results of `getDeviceInfo()`. The `device` and `index` arguments must also apply to one of the available devices.
- `writeBlock(device,index,buffer)`: Overwrites the contents of a storage block with the given buffer.
- `resetBlockNotifications()`: Allows `read-block` and `write-block` events for blocks that were reported previously.
- `applyStimulus(obj)`: Applies an emulator-specific stimulus object (e.g. representing human user input) immediately. If precise timing is required, that timing information should be described within the object itself.
### Events:
- `main-loop`: Dispatched once per iteration of something like the emulator's main loop (typically a few hundred times per second).
- `frame`: Dispatched once per graphical animation frame (typically about 60 frames per second).
    - TODO: document the `details` object expected, assume it is emulator-specific for now
- `read-block`: Dispatched *before* the first read to a block on a device since the last call to `resetBlockNotifications()`. The handler for this event may call `readBlock` to capture the state of this block.
    - `{"device": ..., "index": ...}`
details device id and block index
- `write-block`: Like the `read-block` event, but dispatched before the first write to a block. To recover the data written, call `readBlock` later (e.g. on the next `frame` event)
- `stimulus`: Dispatched upon occurence of an interesting environmental stimulus event (e.g. user input) that pushes the emulated system onto a different trajectory than if the event had not happened. Use `applyStimulus` with these objects to *approximately* replay user interactions.
    - **Do not assume that replaying stimulus events will faithfully recreate a trajectory. Use a sequence of residues to capture that trajectory compactly**
