// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";
import { getFirestore } from "firebase/firestore";
 
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyASbCgmxs3qo-3HQx1v6sIaAxtYf9HDgFw",
  authDomain: "scoorla.firebaseapp.com",
  projectId: "scoorla",
  storageBucket: "scoorla.firebasestorage.app",
  messagingSenderId: "61746219755",
  appId: "1:61746219755:web:f3fb5f67036453b9794cae"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app)
export const db = getDatabase(app)
export const firestore = getFirestore(app)