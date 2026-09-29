"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Dark pill toast, bottom center, as in the pipeline design. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      duration={3800}
      mobileOffset={{ bottom: "calc(74px + env(safe-area-inset-bottom, 0px))" }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "flex max-w-[calc(100vw-32px)] items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[13.5px] text-white shadow-sh3",
          error: "bg-danger",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
