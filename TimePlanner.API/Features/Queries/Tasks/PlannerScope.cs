using System.Linq.Expressions;
using TimePlanner.API.Data;
using TimePlanner.API.Models;
using TimePlanner.API.Models.Organization;

namespace TimePlanner.API.Features.Queries.Tasks;

/// <summary>
/// The tasks that make up a user's own planner and personal analytics:
/// their personal tasks, plus organization tasks assigned to them in organizations where their
/// membership is still active. Organization tasks they only created for other people, and tasks
/// from organizations they left or were removed from, are not part of it.
/// </summary>
public static class PlannerScope
{
    public static Expression<Func<TaskItem, bool>> ForUser(ApplicationDbContext context, Guid userId) =>
        t => (t.OrganizationId == null && t.UserId == userId)
             || (t.OrganizationId != null
                 && t.Assignments.Any(a => a.AssigneeId == userId)
                 && context.OrganizationMemberships.Any(m => m.OrganizationId == t.OrganizationId
                                                             && m.UserId == userId
                                                             && m.Status == MembershipStatus.Active));
}
