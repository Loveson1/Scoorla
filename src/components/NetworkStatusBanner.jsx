import { useEffect, useRef, useState } from "react";

export default function NetworkStatusBanner() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [showRestored, setShowRestored] = useState(false);
  const restoredTimerRef = useRef(null);

  useEffect(() => {
    const handleOffline = () => {
      if (restoredTimerRef.current) {
        clearTimeout(restoredTimerRef.current);
        restoredTimerRef.current = null;
      }
      setShowRestored(false);
      setIsOnline(false);
    };

    const handleOnline = () => {
      setIsOnline(true);
      setShowRestored(true);
      if (restoredTimerRef.current) {
        clearTimeout(restoredTimerRef.current);
      }
      restoredTimerRef.current = setTimeout(() => {
        setShowRestored(false);
      }, 2500);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (restoredTimerRef.current) {
        clearTimeout(restoredTimerRef.current);
      }
    };
  }, []);

  if (!isOnline) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-md">
        Internet connection lost. Scoorla will reconnect automatically when network is restored.
      </div>
    );
  }

  if (showRestored) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[9999] bg-green-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-md">
        Internet connection restored. Scoorla is online.
      </div>
    );
  }

  return null;
}
