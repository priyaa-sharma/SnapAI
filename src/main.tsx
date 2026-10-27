import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider, SignInButton, UserButton, useAuth } from "@clerk/react";
import App from "./App";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AuthenticatedApp() {
  const auth = useAuth();
  return (
    <App
      auth={{ getToken: auth.getToken, isSignedIn: Boolean(auth.isSignedIn), isLoaded: auth.isLoaded }}
      accountControl={
        auth.isSignedIn
          ? <UserButton />
          : <SignInButton mode="modal"><button className="signin-button">Sign in</button></SignInButton>
      }
    />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {publishableKey
      ? <ClerkProvider publishableKey={publishableKey}><AuthenticatedApp /></ClerkProvider>
      : <App auth={null} />}
  </React.StrictMode>,
);
