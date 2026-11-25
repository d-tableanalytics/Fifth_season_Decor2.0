import { ZodError } from 'zod';

export const notFound = (req, res) => res.status(404).json({ message: `Route not found: ${req.originalUrl}` });

const UNIQUE_MESSAGES = {
  users_email_key: 'An employee with this email already exists',
  users_employee_code_uq: 'This employee code is already in use',
  roles_name_lower_uq: 'A role with this name already exists',
  inventory_stock_key_uq: 'This item already exists in this rack for the selected stock type',
  clients_client_id_key: 'A client with this Client ID already exists',
  transports_transport_id_key: 'A transport with this ID already exists',
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return res.status(400).json({ message: issue.message, field: issue.path.join('.') });
  }
  if (err.code === '23505') {
    return res.status(409).json({ message: UNIQUE_MESSAGES[err.constraint] || 'This record already exists' });
  }
  if (err.code === '23503') {
    return res.status(409).json({ message: 'This record is in use by other data and cannot be removed' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }

  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ message: status === 500 ? 'Something went wrong on the server' : err.message, ...(status < 500 && err.details) });
};
