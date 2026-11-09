import { createContext, useContext } from 'react';

/** Opens the search palette (provided by the workspace layout). */
export const SearchContext = createContext<() => void>(() => undefined);
export const useOpenSearch = () => useContext(SearchContext);
