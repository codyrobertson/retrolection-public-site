import { disciplineLabel } from "@/lib/taxonomy";
import styles from "./discipline-filter.module.css";

const options = [["all", "All"], ...Object.entries(disciplineLabel)] as const;

/**
 * Design / Code / Design + Code filter over a card list, with no client JS.
 * "Design + Code" items count as both, so they show under Design and under Code;
 * the "Design + Code" option narrows to only them. Rules live in the CSS.
 */
export function DisciplineFilter({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className={styles.filterable}>
      <fieldset className={styles.filter}>
        <legend className={styles.legend}>Filter by discipline</legend>
        {options.map(([value, label]) => (
          <label key={value} className={styles.option}>
            <input type="radio" name={name} value={value} defaultChecked={value === "all"} />
            {label}
          </label>
        ))}
      </fieldset>
      {children}
    </div>
  );
}
