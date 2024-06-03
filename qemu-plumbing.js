/*
This API is meant to be implemented in an environment like Frida or the browser where the code is executed inside the same process that hosts the actual emulator and events as dispatched synchronously (e.g. the state is not changing during the saving of a residue).

Methods:
    *getDeviceInfo() -> obj containing name, block size, and block count for devices
    saveResidue() -> ArrayBuffer
    restoreResidue(buffer)
    readBlock(device,index) -> ArrayBuffer
    writeBlock(device,index,buffer)
    resetBlockNotifications()
    applyStimulus(obj)
Events:
    main-loop: details nothing
    frame: visual animation frame, details pixels
    read-block: details device id and block index
    write-block: details device id and block index
    stimulus: details an environmental stimulus object

*/

(function () {
    "use strict";
    class EventTarget {
        constructor() {
            this.listeners = {};
        }
        addEventListener(type, listener) {
            if (!(type in this.listeners)) {
                this.listeners[type] = [];
            }
            this.listeners[type].push(listener);
        }
        removeEventListener(type, listener) {
            if (!(type in this.listeners)) {
                return;
            }
            const index = this.listeners[type].indexOf(listener);
            if (index !== -1) {
                this.listeners[type].splice(index, 1);
            }
        }
        dispatchEvent(event) {
            if (!(event.type in this.listeners)) {
                return;
            }
            for (let listener of this.listeners[event.type]) {
                listener.call(this, event);
            }
        }
    }

    const eventTarget = new EventTarget();

    const funcAddr = DebugSymbol.fromName("main_loop_wait").address;
    Interceptor.attach(funcAddr, function () {
        eventTarget.dispatchEvent({ type: "main-loop" });
    });

    const main_loop_wait = DebugSymbol.fromName("main_loop_wait").address;
    const memory = DebugSymbol.fromName("qemu_ram_block_by_name").address;

    const qemu_ram_block_by_name_native = new NativeFunction(memory, "pointer", ["pointer"]);

    const host_pointer_offset = 3 * 8;
    const max_length_pointer_offset = host_pointer_offset + 8 * 4;

    let printed = false;

    Interceptor.attach(main_loop_wait, () => {
        if (!printed) {
            printed = true;

            let res = qemu_ram_block_by_name_native(Memory.allocUtf8String("pc.ram"));

            let host_pointer_address = res.add(host_pointer_offset);
            let host_pointer_value = host_pointer_address.readPointer();

            let max_length_pointer_address = res.add(max_length_pointer_offset);
            let max_length_pointer_value = max_length_pointer_address.readPointer();
            let size = max_length_pointer_value.toInt32();
            Interceptor.attach(main_loop_wait, function () {
                eventTarget.dispatchEvent({ type: "main-loop" });
            });

            Process.setExceptionHandler(function (details) {
                if (details.type === "access-violation") {
                    if (details.memory.operation === "read") {
                        const addr = details.memory.address;
                        Memory.protect(addr, 1, "rw-");

                        eventTarget.dispatchEvent({
                            type: "read-block",
                            device: "memory",
                            index: Math.floor(addr.sub(host_pointer_value).toInt32() / Process.pageSize),
                        });
                        return true;
                    }
                    if (details.memory.operation === "write") {
                        const addr = details.memory.address;
                        Memory.protect(addr, 1, "rw-");
                        eventTarget.dispatchEvent({
                            type: "write-block",
                            device: "memory",
                            index: Math.floor(addr.sub(host_pointer_value).toInt32() / Process.pageSize),
                        });
                        return true;
                    }
                }
                return false;
            });

            Memory.protect(host_pointer_value, size, "---");
        }
    });

    globalThis.QuoteKit = {
        addEventListener: eventTarget.addEventListener.bind(eventTarget),
        removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    };
})();