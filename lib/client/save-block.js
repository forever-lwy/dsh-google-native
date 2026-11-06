/** Keep Send inert until the Host acknowledges options, preserving other owners' blocks. */
export function blockWhileSaving(blocks, sessionId, reason) {
    const ownBlock = { reason };
    const store = blocks.storeFor(sessionId);
    let active = true;
    const ensure = () => {
        if (active && store.getSnapshot() === undefined)
            blocks.set(sessionId, ownBlock);
    };
    const unsubscribe = store.subscribe(ensure);
    ensure();
    return () => {
        active = false;
        unsubscribe();
        if (store.getSnapshot() === ownBlock)
            blocks.set(sessionId, undefined);
    };
}
