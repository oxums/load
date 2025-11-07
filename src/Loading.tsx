import { LoadingSpinner } from "./Spinner";

function Loading() {
  return (
    <main className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
      <LoadingSpinner size={26} />
    </main>
  );
}

export default Loading;
