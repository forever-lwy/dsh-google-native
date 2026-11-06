import { Service } from '@deepseek-ai/cordis';
/** Trusted host-plugin API: the full official SDK, including non-chat APIs. */
export class GoogleNativeService extends Service {
    adapter;
    constructor(ctx, adapter) {
        super(ctx, 'nativeGoogle');
        this.adapter = adapter;
    }
    client(provider) { return this.adapter.client(provider); }
    async generate(provider, parameters) {
        const client = await this.client(provider);
        return client.models.generateContent(parameters);
    }
    async stream(provider, parameters) {
        const client = await this.client(provider);
        return client.models.generateContentStream(parameters);
    }
}
