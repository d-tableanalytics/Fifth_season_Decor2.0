import { createContext, useContext } from 'react';
import { O2D_TYPES } from '../api/o2d';

/** Which O2D order type (Cut / Roll) the current screen works on. Defaults to Cut. */
const O2DContext = createContext(O2D_TYPES.CUT);
export const O2DProvider = ({ type, children }) => <O2DContext.Provider value={O2D_TYPES[type] || O2D_TYPES.CUT}>{children}</O2DContext.Provider>;
export const useO2D = () => useContext(O2DContext);
