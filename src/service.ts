import { Context, Service } from '@deepseek-ai/cordis'
import type { GenerateContentParameters, GoogleGenAI } from '@google/genai'
import type { GoogleNativeAdapter } from './adapter.js'

declare module '@deepseek-ai/cordis' {
  interface Context { nativeGoogle: GoogleNativeService }
}

/** Trusted host-plugin API: the full official SDK, including non-chat APIs. */
export class GoogleNativeService extends Service {
  constructor(ctx: Context, private readonly adapter: GoogleNativeAdapter) {
    super(ctx, 'nativeGoogle')
  }

  client(provider: string): Promise<GoogleGenAI> { return this.adapter.client(provider) }

  async generate(provider: string, parameters: GenerateContentParameters) {
    const client = await this.client(provider)
    return client.models.generateContent(parameters)
  }

  async stream(provider: string, parameters: GenerateContentParameters) {
    const client = await this.client(provider)
    return client.models.generateContentStream(parameters)
  }
}
