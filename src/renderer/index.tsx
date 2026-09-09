import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installAutosave } from './document/autosave';
import { installExpressionSplitter, installMotionSplitter } from './document/loadSession';
import { installTestApi, installUiStoreHandle } from './document/testApi';
import { useEditorUiStore } from './document/stores/editorUiStore';
import './app/styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Không tìm thấy #root');

// Document stores are created at import time, so their autosave and multi-file
// wiring has to be in place before the first edit can happen.
installAutosave();
installExpressionSplitter();
installMotionSplitter();
installTestApi();
installUiStoreHandle(useEditorUiStore);

// Deliberately not wrapped in StrictMode: its double mount/unmount in dev would
// create and tear down the WebGL context and the native Cubism model twice per
// load, which is a real cost here and hides genuine lifecycle bugs.
createRoot(container).render(<App />);
