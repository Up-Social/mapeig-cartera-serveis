import { Children, isValidElement, type FormHTMLAttributes, type ReactNode, type InputHTMLAttributes } from "react";

// Native GET submission keeps URLs shareable and never applies a half-written search.
export function FilterForm({ children, className = "", ...props }: FormHTMLAttributes<HTMLFormElement> & { children: ReactNode }) {
  return <form method="get" {...props} className={`filter-form ${className}`}>
    {Children.map(children, child => {
      if (!isValidElement<InputHTMLAttributes<HTMLInputElement>>(child)) return child;
      const label = child.props["aria-label"];
      if (!label || child.props.type === "hidden" || child.props.type === "checkbox") return child;
      return <label className="filter-field"><span>{label}</span>{child}</label>;
    })}
  </form>;
}
