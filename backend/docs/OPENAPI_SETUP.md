# OpenAPI 3.0 & Swagger UI Setup Guide

## Overview

This document explains the comprehensive OpenAPI 3.0 documentation setup for the Ajo API with interactive Swagger UI.

## Installation

### 1. Install Required Dependencies

```bash
cd backend
npm install openapi-types
```

### 2. Verify Installation

```bash
npm list swagger-ui-express openapi-types
```

Expected output:
```
├── openapi-types@12.0.0
├── swagger-ui-express@5.0.1
└── @types/swagger-ui-express@4.1.8
```

## Project Structure

```
backend/src/docs/
├── openapi-spec.ts          # Main OpenAPI specification
├── schemas/
│   ├── index.ts             # Schema exports
│   ├── error.schema.ts       # Error response schemas
│   ├── auth.schema.ts        # Authentication schemas
│   ├── group.schema.ts       # Group-related schemas
│   └── goal.schema.ts        # Goal-related schemas
└── paths/
    ├── index.ts             # Path exports
    ├── auth.ts              # Authentication endpoints
    ├── groups.ts            # Group endpoints
    └── goals.ts             # Goal endpoints

backend/src/
├── swagger.ts               # Swagger UI setup
└── index.ts                 # Express app with Swagger mounted

backend/docs/
├── API_REFERENCE.md          # Comprehensive API guide
└── OPENAPI_SETUP.md         # This file
```

## How It Works

### 1. Schema Organization

Schemas are organized by domain:
- **error.schema.ts**: Error response formats (Error, ValidationError, NotFoundError, etc.)
- **auth.schema.ts**: Authentication-related schemas (TokenRequest, TokenResponse, KYCStatus, etc.)
- **group.schema.ts**: Group-related schemas (Group, CreateGroupRequest, Contribution, etc.)
- **goal.schema.ts**: Goal-related schemas (Goal, CreateGoalRequest, AffordabilityCheckResponse, etc.)

All schemas are exported from `schemas/index.ts` and merged into the main OpenAPI spec.

### 2. Path Organization

Endpoints are organized by resource:
- **auth.ts**: Authentication and KYC endpoints
- **groups.ts**: Group management endpoints
- **goals.ts**: Goal management endpoints
- **index.ts**: Health, analytics, email, and webhook endpoints

All paths are exported from `paths/index.ts` and merged into the main OpenAPI spec.

### 3. OpenAPI Specification

The main `openapi-spec.ts` file:
- Imports all schemas from `schemas/index.ts`
- Imports all paths from `paths/index.ts`
- Defines security schemes (JWT Bearer)
- Configures servers (development, production)
- Defines tags for endpoint organization
- Includes comprehensive documentation

### 4. Swagger UI Setup

The `swagger.ts` file:
- Mounts Swagger UI at `/api-docs`
- Serves OpenAPI spec as JSON at `/api-docs.json`
- Provides API info endpoint at `/api-docs/info`
- Configures Swagger UI options (persistence, deep linking, etc.)

## Accessing Documentation

### Interactive Swagger UI
- **Development**: http://localhost:3001/api-docs
- **Production**: https://api.ajo.app/api-docs

Features:
- Browse all endpoints
- View request/response schemas
- Try endpoints interactively
- Authorize with JWT token
- See live examples

### OpenAPI Specification
- **JSON Format**: `/api-docs.json`
- **Info Endpoint**: `/api-docs/info`

### Markdown Documentation
- **API Guide**: `backend/docs/API_REFERENCE.md`

## Adding New Endpoints

### 1. Create Schema (if needed)

Add to appropriate schema file in `backend/src/docs/schemas/`:

```typescript
// In group.schema.ts
export const groupSchemas: Record<string, OpenAPIV3.SchemaObject> = {
  // ... existing schemas
  
  NewSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
    },
  },
};
```

### 2. Create Path Definition

Add to appropriate path file in `backend/src/docs/paths/`:

```typescript
// In groups.ts
export const groupPaths: Record<string, OpenAPIV3.PathItemObject> = {
  // ... existing paths
  
  '/api/groups/new-endpoint': {
    post: {
      tags: ['Groups'],
      summary: 'New endpoint summary',
      description: 'Detailed description',
      operationId: 'newEndpointId',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/NewSchema' },
          },
        },
      },
      responses: {
        '201': {
          description: 'Success',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NewSchema' },
            },
          },
        },
      },
    },
  },
};
```

### 3. Export from Index Files

Update `schemas/index.ts`:
```typescript
import { newSchemas } from './new.schema';

export const allSchemas: Record<string, OpenAPIV3.SchemaObject> = {
  ...errorSchemas,
  ...authSchemas,
  ...groupSchemas,
  ...goalSchemas,
  ...newSchemas,  // Add here
};
```

Update `paths/index.ts`:
```typescript
import { newPaths } from './new';

export const allPaths: OpenAPIV3.PathsObject = {
  ...authPaths,
  ...groupPaths,
  ...goalPaths,
  ...newPaths,  // Add here
};
```

## Documentation Standards

### Schema Documentation

Every schema should include:
- Clear property descriptions
- Example values
- Type constraints (min, max, pattern, enum)
- Required fields

```typescript
MySchema: {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: {
      type: 'string',
      example: 'item_123',
      description: 'Unique identifier',
    },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      example: 'My Item',
      description: 'Item name',
    },
    status: {
      type: 'string',
      enum: ['active', 'inactive'],
      example: 'active',
      description: 'Item status',
    },
  },
}
```

### Endpoint Documentation

Every endpoint should include:
- Clear summary and description
- Operation ID for code generation
- All parameters documented
- Request body schema with examples
- All possible responses (success and errors)
- Security requirements

```typescript
'/api/items': {
  post: {
    tags: ['Items'],
    summary: 'Create item',
    description: 'Create a new item with validation',
    operationId: 'createItem',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/CreateItemRequest' },
          examples: {
            default: {
              value: { name: 'My Item' },
            },
          },
        },
      },
    },
    responses: {
      '201': {
        description: 'Item created successfully',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Item' },
          },
        },
      },
      '400': {
        description: 'Invalid input',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ValidationError' },
          },
        },
      },
      '401': {
        description: 'Unauthorized',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/UnauthorizedError' },
          },
        },
      },
    },
  },
}
```

## Testing Documentation

### 1. Verify Swagger UI Loads

```bash
curl http://localhost:3001/api-docs
```

Should return HTML with Swagger UI.

### 2. Verify OpenAPI Spec

```bash
curl http://localhost:3001/api-docs.json | jq .
```

Should return valid JSON OpenAPI specification.

### 3. Test Endpoint in Swagger UI

1. Navigate to http://localhost:3001/api-docs
2. Click "Authorize" button
3. Enter JWT token
4. Find endpoint and click "Try it out"
5. Fill in parameters
6. Click "Execute"
7. View response

### 4. Validate OpenAPI Spec

Use online validator: https://editor.swagger.io/

1. Go to https://editor.swagger.io/
2. Paste OpenAPI spec from `/api-docs.json`
3. Check for validation errors

## Best Practices

### 1. Keep Schemas DRY

Use `$ref` to reference schemas instead of duplicating:

```typescript
// Good
responses: {
  '200': {
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Group' },
      },
    },
  },
}

// Avoid
responses: {
  '200': {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: { /* ... */ },
        },
      },
    },
  },
}
```

### 2. Use Consistent Naming

- Schemas: PascalCase (e.g., `CreateGroupRequest`)
- Paths: kebab-case (e.g., `/api/groups/{id}`)
- Operation IDs: camelCase (e.g., `createGroup`)
- Tags: PascalCase (e.g., `Groups`)

### 3. Document All Responses

Include success and error responses:

```typescript
responses: {
  '200': { /* success */ },
  '400': { /* validation error */ },
  '401': { /* unauthorized */ },
  '404': { /* not found */ },
  '429': { /* rate limit */ },
}
```

### 4. Provide Examples

Include realistic examples for request/response bodies:

```typescript
examples: {
  success: {
    summary: 'Successful response',
    value: { /* realistic data */ },
  },
  error: {
    summary: 'Error response',
    value: { /* error data */ },
  },
}
```

## Troubleshooting

### Swagger UI Not Loading

1. Check if swagger-ui-express is installed: `npm list swagger-ui-express`
2. Verify setupSwagger is called in index.ts
3. Check browser console for errors
4. Verify port is correct (default 3001)

### OpenAPI Spec Invalid

1. Validate at https://editor.swagger.io/
2. Check for missing required fields
3. Verify schema references exist
4. Check for typos in $ref paths

### Endpoints Not Showing

1. Verify paths are exported from `paths/index.ts`
2. Check path format (must start with `/`)
3. Verify tags match defined tags
4. Check for syntax errors in path definition

## Maintenance

### Keeping Documentation Updated

1. Update schemas when data models change
2. Update paths when endpoints change
3. Add new endpoints to appropriate path file
4. Update API_REFERENCE.md with new endpoints
5. Test in Swagger UI after changes

### Version Management

Update version in `openapi-spec.ts`:

```typescript
info: {
  title: 'Ajo API',
  version: '1.1.0',  // Update here
  // ...
}
```

## Resources

- [OpenAPI 3.0 Specification](https://spec.openapis.org/oas/v3.0.3)
- [Swagger UI Documentation](https://swagger.io/tools/swagger-ui/)
- [OpenAPI Types](https://www.npmjs.com/package/openapi-types)
- [Swagger Editor](https://editor.swagger.io/)

## Support

For issues or questions:
- Check existing schemas and paths for examples
- Review OpenAPI 3.0 specification
- Test in Swagger Editor
- Check browser console for errors
