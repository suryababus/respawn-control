import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAs8PJphmaQKR1eH5qQE3JuLhHdFTbelfM",
  authDomain: "respawn-e70cb.firebaseapp.com",
  projectId: "respawn-e70cb",
  storageBucket: "respawn-e70cb.firebasestorage.app",
  messagingSenderId: "686829316377",
  appId: "1:686829316377:web:05acbff850570c4ccd7d88",
  measurementId: "G-7PXBRPYPNQ",
};

const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
export default firebaseApp;
