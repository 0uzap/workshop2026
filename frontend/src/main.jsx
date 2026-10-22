import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Pas de StrictMode : il rejoue les effets en développement, ce qui allumerait
// deux fois la caméra du poste (ressource unique).
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
