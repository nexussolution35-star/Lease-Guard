/**
 * Geometry of a settings row: a 14rem label column, a 2.5rem gap, then the content. Every class that
 * depends on those two numbers lives here, so the form sections, read-only rows and action rows stay aligned.
 */

/** The label column (legend and description) of a floated row, from `lg`. */
export const SETTINGS_ROW_LABEL = 'lg:w-56'
/** The content beside a floated label column, from `lg`: 14rem column + 2.5rem gap. */
export const SETTINGS_ROW_CONTENT = 'lg:ml-66'
/** Left offset that lines an action row up with the content column, from `lg`. */
export const SETTINGS_ROW_ACTIONS = 'lg:pl-66'
/** The same row as a grid, for content that is not a fieldset. */
export const SETTINGS_ROW_GRID = 'grid gap-x-10 lg:grid-cols-[14rem_minmax(0,1fr)]'
/** The grid row for short label and value pairs, which fit side by side from `sm`. */
export const SETTINGS_ROW_GRID_COMPACT = 'grid gap-x-10 sm:grid-cols-[14rem_minmax(0,1fr)]'
/** One hairline between the sections of a settings page; a section that renders nothing leaves no line. */
export const SETTINGS_SECTIONS = 'flex flex-col gap-8 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-8'
