import { inject, provide } from "vue";

const MEETING_CONTEXT_KEY = Symbol("meeting-context");

export function provideMeetingContext(context) {
	provide(MEETING_CONTEXT_KEY, context);
}

export function useMeetingContext() {
	const context = inject(MEETING_CONTEXT_KEY, null);
	return context;
}
