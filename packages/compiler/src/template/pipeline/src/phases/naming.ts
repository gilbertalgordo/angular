/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {sanitizeIdentifier} from '../../../../parse_util';
import {hyphenate} from '../../../../render3/view/style_parser';
import * as ir from '../../ir';
import {ViewCompilationUnit, type CompilationJob, type CompilationUnit, HostBindingCompilationUnit} from '../compilation';
import {prefixWithNamespace} from '../conversion';

/**
 * Generate names for functions and variables across all views.
 *
 * This includes propagating those names into any `ir.ReadVariableExpr`s of those variables, so that
 * the reads can be emitted correctly.
 */
export function phaseNaming(cpl: CompilationJob): void {
  addNamesToView(
      cpl.root, cpl.componentName, {index: 0},
      cpl.compatibility === ir.CompatibilityMode.TemplateDefinitionBuilder);
}

function addNamesToView(
    unit: CompilationUnit, baseName: string, state: {index: number}, compatibility: boolean): void {
  if (unit.fnName === null) {
    unit.fnName = sanitizeIdentifier(`${baseName}_${unit.job.fnSuffix}`);
  }

  // Keep track of the names we assign to variables in the view. We'll need to propagate these
  // into reads of those variables afterwards.
  const varNames = new Map<ir.XrefId, string>();

  for (const op of unit.ops()) {
    switch (op.kind) {
      case ir.OpKind.Property:
      case ir.OpKind.HostProperty:
        if (op.isAnimationTrigger) {
          op.name = '@' + op.name;
        }
        break;
      case ir.OpKind.Listener:
        // TODO: Once we drop compatibility mode, it's likely not important to preserve the distinct
        // naming scheme
        if (unit.job.compatibility && unit instanceof HostBindingCompilationUnit) {
          // TODO: Host binding animation listeners
          op.handlerFnName = sanitizeIdentifier(`${baseName}_${op.name}_HostBindingHandler`);
        } else {
          if (op.handlerFnName === null) {
            if (op.slot === null) {
              throw new Error(`Expected a slot to be assigned`);
            }
            const safeTagName = op.tag ? op.tag.replace('-', '_') : 'host';
            if (op.isAnimationListener) {
              op.handlerFnName = sanitizeIdentifier(`${unit.fnName}_${safeTagName}_animation_${
                  op.name}_${op.animationPhase}_${op.slot}_listener`);
              op.name = `@${op.name}.${op.animationPhase}`;
            } else {
              op.handlerFnName = sanitizeIdentifier(
                  `${unit.fnName}_${safeTagName}_${op.name}_${op.slot}_listener`);
            }
          }
        }
        break;
      case ir.OpKind.Variable:
        varNames.set(op.xref, getVariableName(op.variable, state));
        break;
      case ir.OpKind.Template:
        if (!(unit instanceof ViewCompilationUnit)) {
          throw new Error(`AssertionError: must be compiling a component`);
        }
        const childView = unit.job.views.get(op.xref)!;
        if (op.slot === null) {
          throw new Error(`Expected slot to be assigned`);
        }
        addNamesToView(
            childView, `${baseName}_${prefixWithNamespace(op.tag, op.namespace)}_${op.slot}`, state,
            compatibility);
        break;
      case ir.OpKind.StyleProp:
        op.name = normalizeStylePropName(op.name);
        if (compatibility) {
          op.name = stripImportant(op.name);
        }
        break;
      case ir.OpKind.ClassProp:
        if (compatibility) {
          op.name = stripImportant(op.name);
        }
        break;
    }
  }

  // Having named all variables declared in the view, now we can push those names into the
  // `ir.ReadVariableExpr` expressions which represent reads of those variables.
  for (const op of unit.ops()) {
    ir.visitExpressionsInOp(op, expr => {
      if (!(expr instanceof ir.ReadVariableExpr) || expr.name !== null) {
        return;
      }
      if (!varNames.has(expr.xref)) {
        throw new Error(`Variable ${expr.xref} not yet named`);
      }
      expr.name = varNames.get(expr.xref)!;
    });
  }
}

function getVariableName(variable: ir.SemanticVariable, state: {index: number}): string {
  if (variable.name === null) {
    switch (variable.kind) {
      case ir.SemanticVariableKind.Context:
        variable.name = `ctx_r${state.index++}`;
        break;
      case ir.SemanticVariableKind.Identifier:
        variable.name = `${variable.identifier}_${state.index++}`;
        break;
      default:
        variable.name = `_r${state.index++}`;
        break;
    }
  }
  return variable.name;
}

/**
 * Normalizes a style prop name by hyphenating it (unless its a CSS variable).
 */
function normalizeStylePropName(name: string) {
  return name.startsWith('--') ? name : hyphenate(name);
}

/**
 * Strips `!important` out of the given style or class name.
 */
function stripImportant(name: string) {
  const importantIndex = name.indexOf('!important');
  if (importantIndex > -1) {
    return name.substring(0, importantIndex);
  }
  return name;
}
