// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBridgeAdapter } from '../bridge_adapter';
import { BRIDGE_HANDLER_NAME } from '../bridge-contract';
import type { BridgeEnvelope } from '../types';

const SAMPLE_ENVELOPE: BridgeEnvelope = {
    type: 'lifecycle',
    timestamp: '2026-02-25T00:00:00.000Z',
    message: 'boot',
};

describe('createBridgeAdapter', () => {
    let savedWebkit: unknown;
    let savedBridgeHandler: unknown;

    beforeEach(() => {
        savedWebkit = (window as any).webkit;
        savedBridgeHandler = (window as any)[BRIDGE_HANDLER_NAME];
        delete (window as any).webkit;
        delete (window as any)[BRIDGE_HANDLER_NAME];
    });

    afterEach(() => {
        if (savedWebkit !== undefined) {
            (window as any).webkit = savedWebkit;
        }
        if (savedBridgeHandler !== undefined) {
            (window as any)[BRIDGE_HANDLER_NAME] = savedBridgeHandler;
        }
    });

    it('returns iOS adapter when window.webkit exists', () => {
        const mockPost = vi.fn();
        (window as any).webkit = {
            messageHandlers: { [BRIDGE_HANDLER_NAME]: { postMessage: mockPost } },
        };

        const adapter = createBridgeAdapter();
        adapter.postMessage(SAMPLE_ENVELOPE);

        expect(mockPost).toHaveBeenCalledOnce();
        expect(mockPost).toHaveBeenCalledWith(SAMPLE_ENVELOPE);
    });

    it('returns Android adapter when the handler-name bridge exists', () => {
        const mockPost = vi.fn();
        (window as any)[BRIDGE_HANDLER_NAME] = { postMessage: mockPost };

        const adapter = createBridgeAdapter();
        adapter.postMessage(SAMPLE_ENVELOPE);

        expect(mockPost).toHaveBeenCalledOnce();
        expect(mockPost).toHaveBeenCalledWith(JSON.stringify(SAMPLE_ENVELOPE));
    });

    it('returns no-op adapter when no native bridge exists', () => {
        const adapter = createBridgeAdapter();
        // Should not throw
        expect(() => adapter.postMessage(SAMPLE_ENVELOPE)).not.toThrow();
    });

    it('iOS adapter is safe when messageHandlers is missing', () => {
        (window as any).webkit = {};

        const adapter = createBridgeAdapter();
        expect(() => adapter.postMessage(SAMPLE_ENVELOPE)).not.toThrow();
    });

    it('prefers iOS over Android when both exist', () => {
        const iosMock = vi.fn();
        const androidMock = vi.fn();
        (window as any).webkit = {
            messageHandlers: { [BRIDGE_HANDLER_NAME]: { postMessage: iosMock } },
        };
        (window as any)[BRIDGE_HANDLER_NAME] = { postMessage: androidMock };

        const adapter = createBridgeAdapter();
        adapter.postMessage(SAMPLE_ENVELOPE);

        expect(iosMock).toHaveBeenCalledOnce();
        expect(androidMock).not.toHaveBeenCalled();
    });
});
