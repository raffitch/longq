import React from "react";

const BiohazardIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" {...props}>
    <path
      d="M12 21a9 9 0 0 1-9-9h3a6 6 0 0 0 6 6v3"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7 12a5 5 0 0 0 5 5v-5H7"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M12 7V3" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 11V7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <path
      d="M12 21a9 9 0 0 0 9-9h-3a6 6 0 0 1-6 6v3"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M17 12a5 5 0 0 1-5 5v-5h5"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default BiohazardIcon;
