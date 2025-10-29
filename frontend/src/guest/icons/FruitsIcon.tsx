import React from "react";

const FruitsIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 80 95" xmlns="http://www.w3.org/2000/svg" fill="none" {...props}>
    <path
      d="M1 41.208C1 56.201 3.146 66.916 11.74 79.767c6.53 8.686 15.254 10.861 24.553 4.776a6.3 6.3 0 0 1 6.752 0c9.294 6.09 18.018 3.91 24.548-4.776C76.186 66.911 78.332 56.201 78.332 41.213c0-12.862-9.618-25.714-21.479-25.714-6.124 0-11.648 3.35-15.563 6.96a2.5 2.5 0 0 1-3.248 0c-3.91-3.606-9.44-6.96-15.564-6.96C10.618 15.5 1 28.356 1 41.208Z"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M15.5 44.499c0-7.105 2.194-11.31 7.25-14.5"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M39.666 20.333C39.666 14.533 43.856 1 54.166 1"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default FruitsIcon;
