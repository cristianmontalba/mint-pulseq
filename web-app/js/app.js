/**
 * APP — main controller.
 *
 * Mounts the sidebar and routes between the four interactive tools. The order
 * is the learning path itself: understand Pulseq, watch one sequence taken
 * apart, build your own, then read back the .seq it produced.
 *
 * External coupling:
 *   - window.initLearn(pageId)     → js/learn.js
 *   - window.initWalkthrough(id)   → js/walkthrough.js
 *   - window.initBuilder(preset?)  → js/builder.js
 *   - window.initInspector()       → js/inspector.js
 *   - window.openTool(id, arg)     → exposed here, so a module can hand the
 *                                    reader on to the next one
 *
 * app.js is the only file that owns #content-container; the tools render into
 * it through their own entry points.
 */

document.addEventListener('DOMContentLoaded', () => {
    const navList = document.getElementById('nav-list');
    const contentContainer = document.getElementById('content-container');

    // id → { li, open, moduleName }. Populated by addTool, read by openTool.
    const tools = {};

    /**
     * Mount one sidebar entry.
     * `open` is the module entry point; when it is missing (the script failed
     * to load) the entry still renders and says so instead of doing nothing.
     */
    function addTool(id, label, open, moduleName) {
        const li = document.createElement('li');
        li.className = 'nav-item';
        li.textContent = label;
        li.dataset.id = id;
        li.addEventListener('click', () => activate(id));
        navList.appendChild(li);
        tools[id] = { li, open, moduleName };
        return li;
    }

    /** Open a tool and mark its sidebar entry active. `arg` is passed through. */
    function activate(id, arg) {
        const tool = tools[id];
        if (!tool) return;
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        tool.li.classList.add('active');
        if (tool.open) {
            tool.open(arg);
        } else {
            contentContainer.innerHTML = `<p>The ${tool.moduleName} module is not loaded.</p>`;
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function initSidebar() {
        addTool(
            'learn',
            'Learn Pulseq',
            window.initLearn ? (arg) => window.initLearn(arg) : null,
            'learn.js'
        );

        addTool(
            'walkthrough',
            'Sequence Walkthrough',
            window.initWalkthrough ? (arg) => window.initWalkthrough(arg || 'se-2ddft') : null,
            'walkthrough.js'
        );

        addTool(
            'builder',
            'Sequence Builder',
            window.initBuilder ? (arg) => window.initBuilder(arg) : null,
            'builder.js'
        );

        addTool(
            'inspector',
            'Seq Inspector',
            window.initInspector ? () => window.initInspector() : null,
            'inspector.js'
        );

        // Learn Pulseq is the landing view, so open it straight away.
        activate('learn');
    }

    // The "next in the path" buttons inside each module route through this.
    window.openTool = activate;

    // Start the application
    initSidebar();
});
