/**
 * ForecastIQ — AI Explanation Language Picker
 *
 * Renders a compact flag/language strip in the header.
 * The selected language is sent to the backend so Gemini
 * responds in that language inside the AI Analysis cards.
 *
 * Usage (called automatically on DOMContentLoaded):
 *   LangPicker.get()  → "French"   (current full language name)
 */

const LangPicker = (() => {

    const LANGUAGES = [
        { code: 'en', label: 'EN', flag: '🇬🇧', full: 'English'  },
        { code: 'fr', label: 'FR', flag: '🇫🇷', full: 'French'   },
        { code: 'de', label: 'DE', flag: '🇩🇪', full: 'German'   },
        { code: 'es', label: 'ES', flag: '🇪🇸', full: 'Spanish'  },
        { code: 'cy', label: 'CY', flag: '🏴', full: 'Welsh'    },
    ];

    let current = localStorage.getItem('fiq_ai_lang') || 'en';

    /** Return the full language name for the selected code (sent to backend). */
    function get() {
        const found = LANGUAGES.find(l => l.code === current);
        return found ? found.full : 'English';
    }

    /** Set a language code and persist it. */
    function set(code) {
        if (!LANGUAGES.find(l => l.code === code)) return;
        current = code;
        localStorage.setItem('fiq_ai_lang', code);
        _updateButtons();
        // Toast so user knows the explanation will change on next action
        if (typeof App !== 'undefined') {
            App.showToast(`AI analysis will now appear in ${get()}`, 'info');
        }
    }

    function _updateButtons() {
        document.querySelectorAll('.langpick-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.langCode === current);
        });
    }

    /** Build and inject the language strip into #lang-picker-mount. */
    function init() {
        const mount = document.getElementById('lang-picker-mount');
        if (!mount) return;

        const strip = document.createElement('div');
        strip.className = 'lang-picker-strip';
        strip.title = 'AI Analysis language';

        // Small "AI" label
        const label = document.createElement('span');
        label.className = 'lang-picker-label';
        label.textContent = '🤖';
        label.title = 'Change language of AI analysis';
        strip.appendChild(label);

        LANGUAGES.forEach(lang => {
            const btn = document.createElement('button');
            btn.className = 'langpick-btn' + (lang.code === current ? ' active' : '');
            btn.dataset.langCode = lang.code;
            btn.dataset.label = lang.full;   // used by CSS ::after tooltip
            btn.textContent = lang.label;
            btn.addEventListener('click', () => set(lang.code));
            strip.appendChild(btn);
        });

        mount.appendChild(strip);
    }

    document.addEventListener('DOMContentLoaded', init);

    return { get, set };
})();
