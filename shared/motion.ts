/** One clock per plugin process. Only visible keys participate; slow renders never queue frames. */
type Frame = { render: () => Promise<void>; busy: boolean };
const frames = new Map<string, Frame>();
let timer: NodeJS.Timeout | undefined;

export function watchMotion(id: string, render?: () => Promise<void>): void {
	if (render) {
		const current = frames.get(id);
		if (current) current.render = render;
		else frames.set(id, { render, busy: false });
	} else frames.delete(id);
	if (frames.size && !timer) timer = setInterval(() => {
		for (const [key, frame] of frames) {
			if (frame.busy) continue;
			frame.busy = true;
			void Promise.resolve().then(() => frames.get(key) === frame ? frame.render() : undefined).catch(() => {
				// A disconnected key must not disrupt the other animations.
			}).finally(() => { frame.busy = false; });
		}
	}, 1000 / 12).unref();
	else if (!frames.size && timer) { clearInterval(timer); timer = undefined; }
}
