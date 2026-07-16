/**
 * XiaoBaiDraw —— 从 LittleWhiteBox 提取的纯生图插件
 * 支持 NovelAI / SD WebUI / ComfyUI 三种后端，
 * 并内置“下载生图到本地”（兼容网页与 App/WebView）。
 */
import { EXT_FOLDER_ID, EXT_ID, extensionFolderPath } from "./core/constants.js";
import { initNovelDraw, cleanupNovelDraw } from "./modules/draw/providers/novelai/novel-draw.js";
import { initSdDraw, cleanupSdDraw } from "./modules/draw/providers/sd-webui/sd-draw.js";
import { initComfyDraw, cleanupComfyDraw } from "./modules/draw/providers/comfyui/comfy-draw.js";
import { setupDrawGenerateInterceptor } from "./modules/draw/shared/draw-common.js";

const extension_settings = globalThis.extension_settings;
const saveSettingsDebounced = globalThis.saveSettingsDebounced;

const DRAW_PROVIDER_VALUES = new Set(['disabled', 'novelai', 'sdwebui', 'comfyui']);

extension_settings[EXT_ID] = extension_settings[EXT_ID] || {
    drawProvider: 'disabled',
    novelDraw: { enabled: false },
    sdDraw: { enabled: false },
    comfyDraw: { enabled: false },
};

const settings = extension_settings[EXT_ID];

function normalizeDrawProvider(provider) {
    return DRAW_PROVIDER_VALUES.has(provider) ? provider : 'disabled';
}

function migrateDrawProviderSettings(targetSettings) {
    let changed = false;
    targetSettings.novelDraw ||= {};

    if (targetSettings.drawProvider === undefined) {
        targetSettings.drawProvider = targetSettings.novelDraw?.enabled ? 'novelai' : 'disabled';
        changed = true;
    }

    const normalized = normalizeDrawProvider(targetSettings.drawProvider);
    if (targetSettings.drawProvider !== normalized) {
        targetSettings.drawProvider = normalized;
        changed = true;
    }

    return changed;
}

async function cleanupDrawProvider(provider = settings.drawProvider) {
    const normalized = normalizeDrawProvider(provider);
    if (normalized === 'novelai') {
        try { await cleanupNovelDraw(); } catch (e) { }
    } else if (normalized === 'sdwebui') {
        try { await cleanupSdDraw(); } catch (e) { }
    } else if (normalized === 'comfyui') {
        try { await cleanupComfyDraw(); } catch (e) { }
    }
}

async function initActiveDrawProvider() {
    migrateDrawProviderSettings(settings);
    if (settings.drawProvider === 'novelai') {
        await initNovelDraw();
    } else if (settings.drawProvider === 'sdwebui') {
        await initSdDraw();
    } else if (settings.drawProvider === 'comfyui') {
        await initComfyDraw();
    }
}

function installDrawFacade() {
    function joinDrawTags(...parts) {
        return parts
            .filter(Boolean)
            .map(part => String(part).trim().replace(/[，、]/g, ',').replace(/^,+|,+$/g, ''))
            .filter(part => part.length > 0)
            .join(', ');
    }

    function getProviderGenerateImagesFromText(provider) {
        if (provider === 'novelai') return window.xiaobaixNovelDraw?.generateImagesFromText;
        if (provider === 'sdwebui') return window.xiaobaixSdDraw?.generateImagesFromText;
        if (provider === 'comfyui') return window.xiaobaixComfyDraw?.generateImagesFromText;
        return null;
    }

    function normalizeCharacterPrompts(value) {
        return Array.isArray(value)
            ? value.filter(item => item && typeof item === 'object')
            : [];
    }

    function buildDrawPromptData(input = {}) {
        const provider = normalizeDrawProvider(settings.drawProvider);
        const payload = typeof input === 'string' ? { prompt: input } : (input || {});
        const prompt = String(payload.prompt || payload.tags || '').trim();
        const negativePrompt = String(payload.negativePrompt || payload.negative || '').trim();
        const characterPrompts = normalizeCharacterPrompts(payload.characterPrompts);
        const charPositive = characterPrompts.map(item => item.prompt).filter(Boolean).join(', ');
        const charNegative = characterPrompts.map(item => item.uc).filter(Boolean).join(', ');

        if (provider === 'novelai') {
            const novelDraw = window.xiaobaixNovelDraw;
            const novelSettings = novelDraw?.getSettings?.();
            const preset = novelSettings?.paramsPresets?.find(p => p.id === novelSettings.selectedParamsPresetId)
                || novelSettings?.paramsPresets?.[0];
            return {
                tags: prompt,
                positive: joinDrawTags(preset?.positivePrefix, prompt),
                negativePrompt: negativePrompt || preset?.negativePrefix || '',
                characterPrompts,
                params: preset?.params || {},
                hasParamsPreset: !!preset,
            };
        }

        if (provider === 'sdwebui') {
            const sdDraw = window.xiaobaixSdDraw;
            const sdSettings = sdDraw?.getSettings?.() || {};
            const effective = sdDraw?.getEffectiveParams?.(sdSettings, payload.params || {}) || {};
            return {
                tags: prompt,
                positive: joinDrawTags(effective.positivePrefix || '', prompt, charPositive),
                negativePrompt: joinDrawTags(effective.negativePrefix || '', negativePrompt, charNegative),
                characterPrompts,
                params: effective,
            };
        }

        if (provider === 'comfyui') {
            const comfyDraw = window.xiaobaixComfyDraw;
            const comfySettings = comfyDraw?.getSettings?.() || {};
            const effective = comfyDraw?.getEffectiveParams?.(comfySettings, payload.params || {}) || {};
            return {
                tags: prompt,
                positive: joinDrawTags(effective.positivePrefix || '', prompt, charPositive),
                negativePrompt: joinDrawTags(effective.negativePrefix || '', negativePrompt, charNegative),
                characterPrompts,
                params: effective,
            };
        }

        return {
            tags: prompt,
            positive: prompt,
            negativePrompt,
            characterPrompts,
            params: payload.params || {},
        };
    }

    window.xiaobaixDraw = {
        getProvider() {
            return normalizeDrawProvider(settings.drawProvider);
        },
        isEnabled() {
            return normalizeDrawProvider(settings.drawProvider) !== 'disabled';
        },
        getStatus() {
            const provider = normalizeDrawProvider(settings.drawProvider);
            const enabled = provider !== 'disabled';
            const generateImagesFromText = getProviderGenerateImagesFromText(provider);
            return {
                provider,
                enabled,
                ready: enabled && typeof generateImagesFromText === 'function',
            };
        },
        buildPromptData(input = {}) {
            return buildDrawPromptData(input);
        },
        async generateImage(input = {}) {
            const provider = normalizeDrawProvider(settings.drawProvider);
            const payload = typeof input === 'string' ? { prompt: input } : (input || {});
            const promptData = buildDrawPromptData(payload);

            if (provider === 'novelai') {
                const novelDraw = window.xiaobaixNovelDraw;
                if (!novelDraw?.generateNovelImage) throw new Error('NovelAI 画图模块未初始化');
                if (!promptData.hasParamsPreset) throw new Error('无可用的 NovelAI 参数预设');
                return novelDraw.generateNovelImage({
                    scene: promptData.positive || promptData.tags || '',
                    characterPrompts: promptData.characterPrompts || [],
                    negativePrompt: promptData.negativePrompt || '',
                    params: promptData.params || {},
                    signal: payload.signal,
                });
            }

            if (provider === 'sdwebui') {
                const sdDraw = window.xiaobaixSdDraw;
                if (!sdDraw?.generateSdImage) throw new Error('SD WebUI 画图模块未初始化');
                return sdDraw.generateSdImage({
                    prompt: promptData.positive || promptData.tags || '',
                    negativePrompt: promptData.negativePrompt || '',
                    params: promptData.params || {},
                    signal: payload.signal,
                });
            }

            if (provider === 'comfyui') {
                const comfyDraw = window.xiaobaixComfyDraw;
                if (!comfyDraw?.generateComfyImage) throw new Error('ComfyUI 画图模块未初始化');
                return comfyDraw.generateComfyImage({
                    prompt: promptData.positive || promptData.tags || '',
                    negativePrompt: promptData.negativePrompt || '',
                    params: promptData.params || {},
                    signal: payload.signal,
                });
            }

            throw new Error('未启用画图后端');
        },
        async generateImagesFromText(input = {}) {
            const provider = normalizeDrawProvider(settings.drawProvider);
            if (provider === 'disabled') {
                throw new Error('未启用画图后端');
            }
            const generateImagesFromText = getProviderGenerateImagesFromText(provider);
            if (typeof generateImagesFromText !== 'function') {
                throw new Error('当前画图模块未初始化');
            }
            return generateImagesFromText(input || {});
        },
    };
}

function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(selector);
        if (existing) return resolve(existing);
        const observer = new MutationObserver(() => {
            const found = document.querySelector(selector);
            if (found) {
                observer.disconnect();
                resolve(found);
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`等待元素超时: ${selector}`));
        }, timeout);
    });
}

async function setupSettings() {
    await waitForElement("#extensions_settings");

    const $provider = $("#xiaobaix_draw_provider");
    const $open = $("#xiaobaix_draw_open_settings");

    $provider
        .val(normalizeDrawProvider(settings.drawProvider))
        .on("change", async function () {
            const prev = normalizeDrawProvider(settings.drawProvider);
            const next = normalizeDrawProvider(String($(this).val() || 'disabled'));
            if (next !== $(this).val()) $(this).val(next);
            if (prev === next) return;

            await cleanupDrawProvider(prev);
            settings.drawProvider = next;
            extension_settings[EXT_ID].drawProvider = next;
            saveSettingsDebounced();

            try {
                await initActiveDrawProvider();
            } catch (e) {
                console.error('[XiaoBaiDraw] 初始化画图 provider 失败:', e);
            }
        });

    $open.on("click", function () {
        const provider = normalizeDrawProvider(settings.drawProvider);
        if (provider === 'novelai' && window.xiaobaixNovelDraw?.openSettings) {
            window.xiaobaixNovelDraw.openSettings();
        } else if (provider === 'sdwebui' && window.xiaobaixSdDraw?.openSettings) {
            window.xiaobaixSdDraw.openSettings();
        } else if (provider === 'comfyui' && window.xiaobaixComfyDraw?.openSettings) {
            window.xiaobaixComfyDraw.openSettings();
        } else if (provider === 'disabled') {
            toastr.warning('请先选择画图后端');
        } else {
            toastr.warning('画图模块还没有初始化完成');
        }
    });
}

if (migrateDrawProviderSettings(settings)) {
    saveSettingsDebounced();
}
installDrawFacade();
setupDrawGenerateInterceptor({ shouldStrip: () => true });

jQuery(async () => {
    try {
        const response = await fetch(`${extensionFolderPath}/style.css`);
        const styleElement = document.createElement('style');
        styleElement.textContent = await response.text();
        document.head.appendChild(styleElement);
    } catch (e) {
        console.error('[XiaoBaiDraw] 加载 style.css 失败:', e);
    }

    try {
        // 手动加载 settings.html（manifest 的 settings 字段不会自动加载）
        const ctx = SillyTavern.getContext();
        const settingsHtml = await ctx.renderExtensionTemplateAsync('third-party/' + EXT_FOLDER_ID, 'settings');
        document.getElementById('extensions_settings2')?.insertAdjacentHTML('beforeend', settingsHtml);

        await setupSettings();
        await initActiveDrawProvider();
    } catch (e) {
        console.error('[XiaoBaiDraw] 初始化失败:', e);
    }
});

export { };
