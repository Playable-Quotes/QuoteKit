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

    globalThis.QuoteKit = {
        addEventListener: eventTarget.addEventListener.bind(eventTarget),
        removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    };
})();