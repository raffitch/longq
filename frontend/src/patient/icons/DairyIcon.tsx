import React from "react";

const DairyIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 60 90" xmlns="http://www.w3.org/2000/svg" fill="none" {...props}>
    <path
      d="M10.953 15.786h38.666V6.119a4.833 4.833 0 0 0-4.833-4.833H15.786a4.833 4.833 0 0 0-4.833 4.833v9.667Z"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="m49.619 15.785 5.288 8.502a33 33 0 0 1 4.379 15.322v39.01a9.333 9.333 0 0 1-9.333 9.333H10.952a9.333 9.333 0 0 1-9.666-9.333V39.609A33 33 0 0 1 5.665 24.287l5.288-8.502"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default DairyIcon;
